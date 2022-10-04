#!/usr/bin/env python3
"""Check and publish blocklists for Content Farm Terminator."""
import argparse
import glob
import inspect
import ipaddress
import json
import logging
import os
import re
from contextlib import contextmanager, redirect_stdout
from datetime import datetime, timezone
from functools import partial
from urllib.parse import quote

import requests
import yaml

logging.basicConfig(level=logging.INFO, format='%(levelname)s - %(message)s')
log = logging.getLogger(__name__)


RE_SPACE_MATCHER = re.compile(r'^(\S*)(\s*)(.*)$')
RE_DOMAIN_RULE = re.compile(  # domain name but also allow '*'
    r"""
        ^
        (?:[0-9A-Za-z*](?:[-0-9A-Za-z*]*[0-9A-Za-z*])?)
        (?:\.(?:[0-9A-Za-z*](?:[-0-9A-Za-z*]*[0-9A-Za-z*])?))*
        $
    """,
    flags=re.X,
)
RE_SCHEME_RULE = re.compile(r'^([A-Za-z][0-9A-Za-z+.-]+):(.*)$')
RE_REGEX_RULE = re.compile(r'^/(.*)/([a-z]*)$')
RE_REGEX_SLASH_ESCAPER = re.compile(r'(\\.)|/')


def escape_regex_slash(text):
    """Escape "/"s in a (possibly escaped) regex."""
    return RE_REGEX_SLASH_ESCAPER.sub(lambda m: m.group(1) or r'\/', text)


JS_REGEXP_FLAGS_MAP = {
    'd': 0,
    'g': 0,
    'i': re.IGNORECASE,
    'm': re.MULTILINE,
    's': re.DOTALL,
    'u': 0,
    'y': 0,
}
JS_REGEXP_PATTERN_FIXER = re.compile(
    r"""
        \(\?<(?P<named_group_def>[^>]+)>  # lazy match (may false positive)
        |
        \\k<(?P<named_group_ref>[^>]+)>  # lazy match (may false positive)
        |
        \\u{(?P<braced_unicode_hex>[0-9A-Fa-f]+)}
        |
        (?P<escape>\\.)
    """,
    flags=re.S + re.X,
)


def _compile_regexp_fixer(m, flags=''):
    if m.group('escape'):
        return m.group('escape')
    elif m.group('named_group_def'):
        return rf"(?P<{m.group('named_group_def')}>"
    elif m.group('named_group_ref'):
        return rf"(?P={m.group('named_group_ref')})"
    elif m.group('braced_unicode_hex'):
        if 'u' in flags:
            code = int(m.group('braced_unicode_hex'), 16)
            return rf'\u{code:04X}' if code <= 0xFFFF else rf'\U{code:08X}'
        else:
            return rf"u{{{m.group('braced_unicode_hex')}}}"
    return m.group(0)


def compile_regexp(pattern, flags):
    """Parse a JavaScript style RegExp (as much as possible)."""
    flags_set = set()
    for flag in flags:
        if flag in flags_set:
            raise re.error(f'duplicated flag {flag}')
        flags_set.add(flag)

    flags_py = 0
    for flag in flags_set:
        try:
            flags_py |= JS_REGEXP_FLAGS_MAP[flag]
        except KeyError:
            raise re.error(f'invalid flag {flag}')

    pattern = JS_REGEXP_PATTERN_FIXER.sub(
        partial(_compile_regexp_fixer, flags=flags),
        pattern,
    )

    return re.compile(pattern, flags=flags_py)


def file_strip_eol(file):
    """Strips ending linefeeds for a file.

    Returns:
        bool: True if the file is truncated. False otherwise.
    """
    with open(file, 'r+b') as fh:
        size = pos = fh.seek(0, os.SEEK_END)
        if size == 0:
            # the file is empty and doesn't need truncating
            return False

        pos = fh.seek(-1, os.SEEK_CUR)
        while True:
            byte_ = fh.read(1)
            if byte_ not in (b'\n', b'\r'):
                break
            if pos == 0:
                # first byte is an eol
                fh.seek(-1, os.SEEK_CUR)
                break
            pos = fh.seek(-2, os.SEEK_CUR)

        new_size = fh.truncate()

    return new_size != size


def flatten_files(files, match_pattern='**/*.txt'):
    """Flatten directories in a file list into containing files.

    - Follow alphabetical order.
    - Also normalize file names.
    """
    new_files = []
    for file in files:
        if os.path.isdir(file):
            it = glob.iglob(
                os.path.normpath(os.path.join(glob.escape(file), match_pattern)),
                recursive=True,
            )
            new_files.extend(sorted(it))
        else:
            new_files.append(os.path.normpath(file))
    return new_files


def to_uppercamelcase(text, delim='_'):
    """Convert delimited_text to UpperCamelCase."""
    return ''.join(w.title() for w in text.split(delim))


@contextmanager
def switch_verbosity(verbosity):
    """A context manager that switches log verbosity temporarily."""
    verbosity_ = log.getEffectiveLevel()
    log.setLevel(verbosity)
    yield
    log.setLevel(verbosity_)


class Rule:
    """A class that represents a rule line."""
    def __init__(self, input, path='.', line_no=-1):
        """Initialize a Rule.

        Args:
            input (str): a rule line, including comment
            path (str): path of the source file
            line_no (int): line number of the source file, 1-based.
        """
        self.input = input
        self.path = path
        self.line_no = line_no

        m = RE_SPACE_MATCHER.search(input)
        self.set_rule(m.group(1))
        self.sep = m.group(2)
        self.comment = m.group(3)

    def __repr__(self):
        return f'Rule({repr(self.rule)})'

    def set_rule(self, rule):
        """Change the rule and related attributes."""
        self.rule = rule
        self.type = None

        # regex
        m = RE_REGEX_RULE.search(self.rule)
        if m:
            self.type = 'regex'
            self.pattern = m.group(1)
            self.flags = m.group(2)
            return

        # scheme
        m = RE_SCHEME_RULE.search(self.rule)
        if m:
            self.type = 'scheme'
            self.scheme = m.group(1)
            self.value = m.group(2)
            return

        # ipv6
        if self.rule.startswith('[') and self.rule.endswith(']'):
            try:
                ip = ipaddress.ip_address(self.rule[1:-1])
            except ValueError:
                pass
            else:
                if ip.version == 6:
                    self.type = 'ipv6'
            return

        # ipv4
        try:
            ip = ipaddress.ip_address(self.rule)
        except ValueError:
            pass
        else:
            if ip.version == 4:
                self.type = 'ipv4'
                return

        # domain
        m = RE_DOMAIN_RULE.search(self.rule)
        if m:
            self.type = 'domain'
            return

    def set_rule_raw(self, text):
        """Force using the given text as rule."""
        self.rule = text
        if text:
            self.type = 'raw'
        else:
            self.type = None


class Linter:
    """Check for issues of the source files."""
    def __init__(self, root, config=None, files=None, check_regex=False, remove_empty=False,
                 auto_fix=False, sort_rules=False, strip_eol=False):
        self.root = root
        self.config = config or {}
        self.files = flatten_files(files or [])
        self.check_regex = check_regex
        self.remove_empty = remove_empty
        self.auto_fix = auto_fix
        self.sort_rules = sort_rules
        self.strip_eol = strip_eol

    def run(self):
        for file in self.files:
            self.check_file(file)

    def check_file(self, file):
        log.debug('Checking %s ...', file)

        subpath = os.path.relpath(file, self.root)
        rules = []
        try:
            fh = open(file, encoding='UTF-8-SIG')
        except OSError as exc:
            log.warning('Unable to check file "%s": %s', subpath, exc)
            return
        else:
            with fh as fh:
                for i, line in enumerate(fh):
                    line = line.rstrip('\n')
                    rule = Rule(line, path=subpath, line_no=i + 1)
                    rules.append(rule)

        new_rules = []
        for rule in rules:
            new_rule = self.check_rule(rule)
            if self.auto_fix:
                if new_rule:
                    new_rules.append(new_rule)
            else:
                new_rules.append(rule)

        # keep empty rules in-place
        if self.sort_rules:
            def sort_rules(rules):
                def append_stack():
                    if not stack:
                        return
                    stack.sort(key=lambda rule: (rule.rule, rule.sep, rule.comment))
                    new_rules.extend(stack)
                    stack.clear()

                new_rules = []
                stack = []
                for rule in rules:
                    if not rule.rule:
                        append_stack()
                        new_rules.append(rule)
                    else:
                        stack.append(rule)
                append_stack()
                return new_rules

            new_rules = sort_rules(new_rules)

        if new_rules != rules:
            log.info('Saving auto-fixed %s ...', subpath)
            with open(file, 'w', encoding='UTF-8') as fh:
                for rule in new_rules:
                    print(f'{rule.rule}{rule.sep}{rule.comment}', file=fh)

        if self.strip_eol:
            if file_strip_eol(file):
                log.info('Stripped EOL for %s', subpath)

    def check_rule(self, rule):
        """Check the given rule.

        Returns:
            - The original Rule if valid.
            - A new Rule if it can be auto-fixed.
            - None if invalid.
        """
        if rule.type is None:
            # A rule of None type should be empty; otherwise it has an invalid
            # format that cannot be recognized as another type.
            if rule.rule.strip():
                log.info('%s:%i: rule "%s" is invalid',
                         rule.path, rule.line_no, rule.rule)
                return None

            if self.remove_empty:
                if not rule.rule and not rule.comment:
                    log.info('%s:%i: rule is empty',
                             rule.path, rule.line_no)
                    return None

        elif rule.type == 'domain':
            fixed_rule = rule.rule.lower()
            if rule.rule != fixed_rule:
                log.info('%s:%i: rule "%s" should be all lowercase',
                         rule.path, rule.line_no, rule.rule)
                rule = Rule(f'{fixed_rule}{rule.sep}{rule.comment}')

            if '**' in rule.rule:
                log.info('%s:%i: rule "%s" has "**"',
                         rule.path, rule.line_no, rule.rule)
                fixed_rule = re.sub(r'\*+', r'*', rule.rule)
                rule = Rule(f'{fixed_rule}{rule.sep}{rule.comment}')

        elif rule.type == 'regex':
            if self.check_regex:
                try:
                    compile_regexp(rule.pattern, rule.flags)
                except re.error as exc:
                    log.info('%s:%i: regex "%s" is invalid: %s',
                             rule.path, rule.line_no, rule.rule, exc)
                    return None

        elif rule.type == 'scheme':
            fixed_scheme = rule.scheme.lower()
            if rule.scheme != fixed_scheme:
                log.info('%s:%i: scheme of rule "%s" should be all lowercase',
                         rule.path, rule.line_no, rule.rule)
                return Rule(f'{fixed_scheme}:{rule.value}{rule.sep}{rule.comment}')

        return rule


class Uniquifier:
    """Check for duplicated rules of the source files."""
    def __init__(self, root, config=None, files=None, advanced=False, cross_files=False,
                 auto_fix=False, auto_fix_excludes=None, strip_eol=False):
        self.root = root
        self.config = config or {}
        self.files = flatten_files(files or [])
        self.advanced = advanced
        self.cross_files = cross_files
        self.auto_fix = auto_fix
        self.auto_fix_excludes = set(flatten_files(auto_fix_excludes or []))
        self.strip_eol = strip_eol

    def run(self):
        rules = []
        for file in self.files:
            log.debug('Adding rules for uniquification: %s ...', file)
            subpath = os.path.relpath(file, self.root)
            try:
                fh = open(file, encoding='UTF-8-SIG')
            except OSError as exc:
                log.warning('Unable to add source "%s" for uniquification: %s', subpath, exc)
            else:
                with fh as fh:
                    for i, line in enumerate(fh):
                        line = line.rstrip('\n')
                        rule = Rule(line, path=subpath, line_no=i + 1)
                        rules.append(rule)

        if self.cross_files:
            new_rules = self.deduplicate_rules(rules)
            if self.advanced:
                new_rules = self.check_covered_rules(new_rules)
            if self.auto_fix and new_rules != rules:
                rulegroups = {}
                for rule in new_rules:
                    rulegroups.setdefault(rule.path, []).append(rule)
                for subpath, new_rules in rulegroups.items():
                    self.save_fixed_file(subpath, new_rules)

        else:
            rulegroups = {}
            for rule in rules:
                rulegroups.setdefault(rule.path, []).append(rule)
            for subpath, rules in rulegroups.items():
                new_rules = self.deduplicate_rules(rules)
                if self.advanced:
                    new_rules = self.check_covered_rules(new_rules)
                if self.auto_fix and new_rules != rules:
                    self.save_fixed_file(subpath, new_rules)

    def deduplicate_rules(self, rules):
        new_rules = []
        rules_dict = {}
        for rule in rules:
            if rule.rule:
                try:
                    rule2 = rules_dict[rule.rule]
                except KeyError:
                    rules_dict[rule.rule] = rule
                else:
                    log.info('%s:%i: rule "%s" duplicates %s:%i',
                             rule.path, rule.line_no, rule.rule, rule2.path, rule2.line_no)
                    continue
            new_rules.append(rule)
        return new_rules

    def check_covered_rules(self, rules):
        new_rules = []

        regex_dict = {}
        for rule in rules:
            if rule.type == 'domain':
                regex_dict[rule] = re.compile(
                    r'^(?:[\w*-]+\.)*'
                    + re.escape(rule.rule).replace(r'\*', r'[\w*-]*')
                    + '$')

        for rule in rules:
            ok = True
            if rule.type == 'domain':
                for rule2 in rules:
                    if rule2.path == rule.path and rule2.line_no == rule.line_no:
                        continue

                    try:
                        regex = regex_dict[rule2]
                    except KeyError:
                        continue

                    if regex.search(rule.rule):
                        log.info('%s:%i: domain "%s" is covered by rule "%s" (%s:%i)',
                                 rule.path, rule.line_no, rule.rule, rule2.rule, rule2.path, rule2.line_no)
                        ok = False
                        continue

            if ok:
                new_rules.append(rule)

        return new_rules

    def save_fixed_file(self, subpath, rules):
        file = os.path.join(self.root, subpath)
        if any(os.path.samefile(file, f) for f in self.auto_fix_excludes):
            return

        log.info('Saving auto-fixed %s ...', subpath)
        with open(file, 'w', encoding='UTF-8') as fh:
            for rule in rules:
                print(f'{rule.rule}{rule.sep}{rule.comment}', file=fh)

        if self.strip_eol:
            if file_strip_eol(file):
                log.debug('Stripped EOL for %s', subpath)


class Builder:
    """Build dist files from the source files."""
    def __init__(self, root, config=None):
        self.root = root
        self.config = config or {}
        self.date = datetime.now()

    def run(self):
        for task in self.config.get('build', []):
            self.run_task(task)

    def run_task(self, task):
        src_files = task['source']
        src_files = [src_files] if isinstance(src_files, str) else src_files
        src_files = flatten_files(os.path.join(self.root, f) for f in src_files)

        dst_file = os.path.normpath(os.path.join(self.root, task['publish']))

        log.info('Building "%s" ...', os.path.relpath(dst_file, self.root))
        os.makedirs(os.path.dirname(dst_file), exist_ok=True)

        with open(dst_file, 'w', encoding='UTF-8') as oh:
            with redirect_stdout(oh):
                converter = get_converter(task.get('type', 'cft'))
                converter(None, task.get('data', {}), self.date).print_headers()

                for src_file in src_files:
                    log.info('Adding "%s" ...', os.path.relpath(src_file, self.root))
                    try:
                        ih = open(src_file, 'r', encoding='UTF-8-SIG')
                    except OSError as exc:
                        log.warning('Unable to add source "%s" when building "%s": %s',
                                    os.path.relpath(src_file, self.root),
                                    os.path.relpath(dst_file, self.root),
                                    exc)
                    else:
                        with ih as ih:
                            converter = get_converter(task.get('type', 'cft'))
                            converter(ih, task.get('data', {}), self.date).run()


def get_converter(name):
    """Get a converter of name."""
    converter = globals().get('Converter' + to_uppercamelcase(name))

    # make sure it's really a subclass of Converter
    try:
        assert issubclass(converter, Converter)
    except (TypeError, AssertionError):
        return None

    return converter


class Converter:
    """Convert a source file."""
    allow_schemes = True

    def __init__(self, fh, info, date):
        self.fh = fh
        self.info = info
        self.date = date

    def run(self):
        scheme_groups = {}
        for line in self.fh:
            line = line.rstrip('\n')
            rule = Rule(line)

            # skip empty rule
            if rule.type is None:
                self.print_rule(rule)
                continue

            # apply processors
            self.process_rule(rule, self.info.get('processors', []))

            # special handling for a scheme rule, which forcely defines the raw output rule
            if self.allow_schemes and rule.type == 'scheme':
                self.handle_scheme_rule(rule, scheme_groups)

                # A rule should be set to another type if handled. This is
                # either specially handled for grouping or invalid, and should
                # be skipped here.
                if rule.type == 'scheme':
                    continue

            self.print_rule(rule)

        self.handle_grouping_scheme_rules(scheme_groups)

    def process_rule(self, rule, processors):
        """Modify a rule using given processors."""
        for processor in processors:
            if processor.get('type') not in (rule.type, None):
                continue

            find = processor.get('find')
            pattern = processor.get('pattern')
            regex = re.compile(pattern) if pattern is not None else None
            text = rule.rule
            if find is not None:
                if find not in text:
                    continue
            elif regex is not None:
                if not regex.search(text):
                    continue

            replacement = processor.get('replacement', '')
            new_rule = replacement if regex is None else regex.sub(replacement, text)

            mode = processor.get('mode')
            if mode == 'raw':
                rule.set_rule_raw(new_rule)
            else:
                rule.set_rule(new_rule)

            return

    def handle_scheme_rule(self, rule, scheme_groups):
        """Handle a scheme rule."""
        scheme = self.info.get('schemes', {}).get(rule.scheme)
        if scheme is None:
            log.warning('Rule "%s" has an undefined scheme', rule.rule)
            return

        value = rule.value
        if not value:
            return

        # apply escapers
        for escaper in scheme.get('escape', '').split(','):
            escaper = escaper.strip()
            if not escaper:
                continue

            try:
                escaper = getattr(self, f'escape_{escaper}')
            except AttributeError:
                log.warning('Escaper "%s" is not defined', escaper)
            else:
                value = escaper(value)

        # special handling for grouping rules:
        # store the value in the dict for later processing
        if scheme.get('grouping'):
            scheme_groups.setdefault(rule.scheme, []).append((value, rule))
            return

        value = scheme.get('value', '').format(value=value)

        # apply max length limit
        scheme_max = scheme.get('max')
        if scheme_max is not None:
            if len(value) > scheme_max:
                log.warning('Rule "%s" exceeds max length %i', rule.rule, scheme_max)
                return

        mode = scheme.get('mode')
        if mode == 'raw':
            rule.set_rule_raw(value)
        else:
            rule.set_rule(value)

    def handle_grouping_scheme_rules(self, scheme_groups):
        """Output collected grouping scheme rules."""
        def get_joined_value(pos=None):
            rng = range(len(items) if pos is None else pos)
            value = scheme_sep.join(items[i][0] for i in rng)
            value = scheme_value.format(value=value)
            return value

        def bsearch(items):
            """Search for the max pos that all values can fit within the max length."""
            # Check if all can fit, which should be the most common case.
            pos = len(items)
            value = get_joined_value(pos)
            if len(value) <= scheme_max:
                return pos, value

            # Modified binary search to find the max fitting pos.
            pos_max = pos - 1  # skip last pos, which has been checked
            pos_min = 0
            while pos_min <= pos_max:
                pos = pos_min + (pos_max - pos_min) // 2
                value = get_joined_value(pos)
                if len(value) <= scheme_max:
                    pos_min = pos + 1
                else:
                    pos_max = pos - 1
            return pos, value

        schemes = self.info.get('schemes', {})
        for scheme_name, items in scheme_groups.items():
            scheme = schemes[scheme_name]
            scheme_value = scheme.get('value', '')
            scheme_sep = scheme['grouping']
            scheme_max = scheme.get('max')

            outputs = []
            if scheme_max is None:
                outputs.append(get_joined_value())
            else:
                while items:
                    pos, value = bsearch(items)
                    if pos > 0:
                        outputs.append(value)
                        items = items[pos:]
                    else:
                        log.warning('Rule "%s" exceeds max length %i', items[0][1].rule, scheme_max)
                        items = items[1:]

            mode = scheme.get('mode')
            for output in outputs:
                rule = Rule('')
                if mode == 'raw':
                    rule.set_rule_raw(output)
                else:
                    rule.set_rule(output)
                self.print_rule(rule)

    def print_headers(self):
        try:
            headers = self.info['headers']
        except KeyError:
            return

        headers = headers.rstrip('\n').format(
            now=self.date.astimezone(timezone.utc).isoformat(timespec='seconds'),
        )
        headers = '\n'.join(f'# {s}' for s in headers.split('\n'))
        print(headers)

    def print_rule(self, rule):
        print(rule.rule + rule.sep + rule.comment)

    def escape_regex(self, value):
        return re.escape(value)

    def escape_regex_with_wildcard_a(self, value):
        return '.*'.join(re.escape(s) for s in value.split('*'))

    def escape_url(self, value):
        return quote(value)


class ConverterCopy(Converter):
    """Copy to the target and add a header."""
    def run(self):
        for line in self.fh:
            print(line, end='')

    def print_headers(self):
        try:
            headers = self.info['headers']
        except KeyError:
            return

        headers = headers.rstrip('\n').format(
            now=self.date.astimezone(timezone.utc).isoformat(timespec='seconds'),
        )
        print(headers)


class ConverterCft(Converter):
    """Convert to a canonical Content Farm Terminator blocklist."""
    def print_headers(self):
        try:
            headers = self.info['headers']
        except KeyError:
            return

        headers = headers.rstrip('\n').format(
            now=self.date.astimezone(timezone.utc).isoformat(timespec='seconds'),
        )
        headers = '\n'.join(f'  # {s}' for s in headers.split('\n'))
        print(headers)

    def print_rule(self, rule):
        # skip invalid rule
        if rule.type is None and rule.rule:
            return

        print(rule.rule + rule.sep + rule.comment)


class ConverterHosts(Converter):
    r"""Convert to the hosts file format.

    Common system paths:
    - Windows: %SystemRoot%\System32\drivers\etc\hosts
    - *nix: /etc/hosts
    """
    allow_schemes = False

    def print_rule(self, rule):
        comment = '  #' + re.sub(r'^\s*(?://|#)', r'', rule.comment) if rule.comment else ''

        if (
            rule.type == 'domain' and '*' not in rule.rule
            or rule.type == 'raw'
        ):
            print(f'127.0.0.1 {rule.rule}{comment}')

        elif rule.type is None:
            if rule.comment and not rule.rule:
                print(comment.lstrip())


class ConverterUbo(Converter):
    """Convert to an uBlock Origin blocklist.

    https://github.com/gorhill/uBlock/wiki/Static-filter-syntax
    https://help.eyeo.com/en/adblockplus/how-to-write-filters
    """
    def print_headers(self):
        try:
            headers = self.info['headers']
        except KeyError:
            return

        headers = headers.rstrip('\n').format(
            now=self.date.astimezone(timezone.utc).isoformat(timespec='seconds'),
        )
        headers = '\n'.join(f'! {s}' for s in headers.split('\n'))
        print(headers)

    def print_rule(self, rule):
        comment = '  #' + re.sub(r'^\s*(?://|#)', r'', rule.comment) if rule.comment else ''

        if rule.type == 'regex':
            regex = rule.rule
            print(f'{regex}$document{comment}')

        elif rule.type in ('domain', 'ipv4', 'ipv6'):
            domain = rule.rule
            if '*' in domain:
                print(f'||{domain}^$document{comment}')
            else:
                print(f'||{domain}^{comment}')

        elif rule.type == 'raw':
            print(f'{rule.rule}{comment}')

        elif rule.type is None:
            if rule.comment and not rule.rule:
                print(comment.lstrip())


class ConverterUblacklist(Converter):
    """Convert to an uBlacklist blocklist.

    https://github.com/iorate/ublacklist
    """
    def print_rule(self, rule):
        comment = '  #' + re.sub(r'^\s*(?://|#)', r'', rule.comment) if rule.comment else ''

        if rule.type == 'regex':
            print(f'/{escape_regex_slash(rule.pattern)}/{rule.flags}{comment}')

        elif rule.type in ('ipv4', 'ipv6'):
            print(f'*://{rule.rule}/*{comment}')

        elif rule.type == 'domain':
            domain = rule.rule

            # uBlacklist supports host match pattern,
            # which requires "*." be at the start of domain.
            # Replace with a regex rule to get it work.
            if '*' in domain:
                domain = re.escape(domain).replace(r'\*', r'[\w.-]*')
                print(rf'/https?:\/\/(?:[\w-]+\.)*(?:{domain})(?=[:\/?#]|$)/{comment}')
            else:
                print(f'*://*.{domain}/*{comment}')

        elif rule.type == 'raw':
            print(f'{rule.rule}{comment}')

        elif rule.type is None:
            if rule.comment and not rule.rule:
                print(comment.lstrip())


class Aggregator:
    """Aggregate blocklists from external files."""
    def __init__(self, root, config=None):
        self.root = root
        self.config = config or {}

    def run(self):
        for i, task in enumerate(self.config.get('aggregate', [])):
            self.run_task(task, i)

    def run_task(self, task, index):
        name = task.get('name', str(index + 1))
        homepage = task.get('homepage')
        url = task['source']
        dest = os.path.normpath(os.path.join(self.root, task['dest']))
        type = task.get('type', 'domains_txt')
        strip_eol = task.get('strip_eol', False)

        log.info('Aggregating rules from "%s" to %s ...', url, dest)
        try:
            r = requests.get(url)
        except requests.exceptions.RequestException as exc:
            log.error('Failed to fetch "%s": %s', url, exc)
            return

        if not r.ok:
            log.error('Failed to fetch "%s": %i', url, r.status_code)
            return

        text = r.text
        rules = self.convert_rules(type, text, url)

        s_homepage = f' ({homepage})' if homepage else ''
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, 'w', encoding='UTF-8') as fh:
            with redirect_stdout(fh):
                print(f'  #!aggreg-{name}: {url}{s_homepage}')
                for rule in rules:
                    print(f'{rule.rule} {rule.comment}{" " if rule.comment else ""}#!aggreg-{name}')

        if strip_eol:
            log.debug('Stripping eol for %s ...', dest)
            file_strip_eol(dest)

    def convert_rules(self, type, text, url):
        fn = getattr(self, f'convert_rules_{type}')
        return fn(text, url)

    def convert_rules_domains_txt(self, text, url):
        """Parse a file with line-separated domains."""
        rules = []
        for i, domain in enumerate(text.split('\n')):
            if not domain.strip():
                continue
            rule = Rule(domain, path=url, line_no=i + 1)
            rules.append(rule)
        return rules

    def convert_rules_domains_json(self, text, url):
        """Parse a JSON with an Array of domains."""
        rules = []
        for domain in json.loads(text):
            if not domain.strip():
                continue
            rule = Rule(domain, path=url)
            rules.append(rule)
        return rules

    def convert_rules_ublacklist(self, text, url):
        def re_line():
            """Line parser for uBlacklist.

            - Taken from the source code of uBlacklist.
            """
            spaceBeforeRuleOrComment = rf"""(?P<spaceBeforeRuleOrComment>\s+)"""  # noqa: N806, F541
            color = rf"""(?P<color>0|[1-9]\d*)"""  # noqa: N806, F541
            highlight = rf"""(?P<highlight>@{color}?)"""  # noqa: N806, F541
            spaceAfterHighlight = rf"""(?P<spaceAfterHighlight>\s+)"""  # noqa: N806, F541
            scheme = rf"""(?P<scheme>\*|[Hh][Tt][Tt][Pp][Ss]?|[Ff][Tt][Pp])"""  # noqa: N806, F541
            label = rf"""(?:[0-9A-Za-z](?:[-0-9A-Za-z]*[0-9A-Za-z])?)"""  # noqa: N806, F541
            host = rf"""(?P<host>(?:\*|{label})(?:\.{label})*)"""  # noqa: N806, F541
            path = rf"""(?P<path>/(?:\*|[-0-9A-Za-z._~:/?[\]@!$&'()+,;=]|%[0-9A-Fa-f]{2})*)"""  # noqa: N806, F541
            matchPattern = rf"""(?P<matchPattern>{scheme}://{host}{path})"""  # noqa: N806, F541
            prop = rf"""(?P<prop>u(?:rl)?|t(?:itle)?)"""  # noqa: N806, F541
            backslashSequence = rf"""(?:\\.)"""  # noqa: N806, F541
            class_ = rf"""(?:\[(?:[^\]\\]|{backslashSequence})*])"""  # noqa: N806, F541
            firstChar = rf"""(?:[^*\\/[]|{backslashSequence}|{class_})"""  # noqa: N806, F541
            char = rf"""(?:[^\\/[]|{backslashSequence}|{class_})"""  # noqa: N806, F541
            pattern = rf"""(?P<pattern>{firstChar}{char}*)"""  # noqa: N806, F541
            flags = rf"""(?P<flags>iu?|ui?)"""  # noqa: N806, F541
            regularExpression = rf"""(?P<regularExpression>{prop}?/{pattern}/{flags}?)"""  # noqa: N806, F541
            rule = rf"""(?P<rule>({highlight}{spaceAfterHighlight}?)?(?:{matchPattern}|{regularExpression}))"""  # noqa: N806, F541
            spaceAfterRule = rf"""(?P<spaceAfterRule>\s+)"""  # noqa: N806, F541
            comment = rf"""(?P<comment>#.*)"""  # noqa: N806, F541
            line = rf"""^{spaceBeforeRuleOrComment}?(?:{rule}{spaceAfterRule}?)?{comment}?$"""  # noqa: N806, F541
            return re.compile(line)

        regex = re_line()
        rules = []
        for i, line in enumerate(text.split('\n')):
            if not line.strip():
                continue

            m = regex.search(line)
            if not m:
                continue

            # a highlight rule does not block
            if m.group('highlight'):
                continue

            comment = f' {m.group("comment")}' if m.group('comment') else ''
            if m.group('matchPattern'):
                if m.group('host') != '*' and m.group('path') in ('/*', '/'):
                    # treat "*://*.example.com/" as "*://*.example.com/*"
                    domain = m.group('host')

                    # treat "*://example.com/*" as "*://*.example.com/*"
                    if domain.startswith('*.'):
                        domain = domain[2:]

                    # treat "*://www.example.com/*" as "*://*.example.com/*"
                    if domain.startswith('www.'):
                        domain = domain[4:]

                    # treat "*://*.example.com/" as "*://*.example.com/*"
                    if m.group('path') in ('/*', '/'):
                        rule = f'{domain}{comment}'
                    else:
                        pattern = re.escape(m.group('domain'))
                        re.escape(m.group('path')).replace(r'\*', r'.*')
                        rule = f'domain-path-re:{pattern}{comment}'

                else:
                    path = m.group('path')
                    domain = m.group('host')
                    if domain == '*':
                        rule = f'mp-path:{path[1:]}'
                    elif domain.startswith('*.'):
                        rule = f'mp-hosts-path:{domain[2:]}{path}'
                    else:
                        rule = f'mp-host-path:{domain}{path}'

            elif m.group('regularExpression'):
                # title match is not supported
                if m.group('prop') in ('title', 't'):
                    continue

                rule = f'/{m.group("pattern")}/{m.group("flags") or ""}{comment}'

            else:
                # non-rule, such as comment line
                continue

            rule = Rule(rule, path=url, line_no=i + 1)
            rules.append(rule)

        return rules


def parse_args(argv=None):
    root = os.path.normpath(os.path.join(__file__, '..', '..'))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.set_defaults(
        root=root,
        config=os.path.join(root, 'src', 'config.yaml'),
        verbosity=logging.INFO)
    parser.add_argument(
        '--root',
        help="""root directory to manipulate (default: %(default)s)""")
    parser.add_argument(
        '--config',
        help="""config file to use (default: %(default)s)""")
    parser.add_argument(
        '-q', '--quiet', dest='verbosity', action='store_const', const=logging.WARNING,
        help="""show only warnings or errors""")
    parser.add_argument(
        '-v', '--verbose', dest='verbosity', action='store_const', const=logging.DEBUG,
        help="""show debug information""")

    subparsers = parser.add_subparsers(
        metavar='ACTION', dest='action', required=True,
        help="""the action to run (default: run auto tasks by config)""")

    # lint
    parser_lint = subparsers.add_parser(
        'lint', aliases=['l'],
        help="""run the linter""",
        description=Linter.__doc__)
    parser_lint.add_argument(
        'files', metavar='file', nargs='+',
        help="""file(s) to check""")
    parser_lint.add_argument(
        '-r', '--check-regex', action='store_true', default=False,
        help="""check the syntax for regex rules (NOTE: This may be inaccurate
                as Python may fail to parse a valid JavaScript regex.)""")
    parser_lint.add_argument(
        '-e', '--remove-empty', action='store_true', default=False,
        help="""check and remove empty lines""")
    parser_lint.add_argument(
        '-a', '--auto-fix', action='store_true', default=False,
        help="""automatically fix issues""")
    parser_lint.add_argument(
        '-s', '--sort-rules', action='store_true', default=False,
        help="""sort rules alphabetically""")
    parser_lint.add_argument(
        '-t', '--strip-eol', action='store_true', default=False,
        help="""remove ending linefeeds""")

    # uniquify
    parser_uniquify = subparsers.add_parser(
        'uniquify', aliases=['u'],
        help="""run the uniquifier""",
        description=Uniquifier.__doc__)
    parser_uniquify.add_argument(
        'files', metavar='file', nargs='+',
        help="""file(s) to check""")
    parser_uniquify.add_argument(
        '--advanced', action='store_true', default=False,
        help="""check for advanced rule coverage (may take long time)""")
    parser_uniquify.add_argument(
        '-c', '--cross-files', action='store_true', default=False,
        help="""check for uniquity across files""")
    parser_uniquify.add_argument(
        '-a', '--auto-fix', action='store_true', default=False,
        help="""automatically fix issues""")
    parser_uniquify.add_argument(
        '-X', '--auto-fix-excludes', metavar='file', nargs='+',
        help="""exclude file(s) from modified by --auto-fix""")
    parser_uniquify.add_argument(
        '-t', '--strip-eol', action='store_true', default=False,
        help="""remove ending linefeeds""")

    # build
    subparsers.add_parser(
        'build', aliases=['b'],
        help="""run the builder""",
        description=Builder.__doc__)

    # aggregate
    subparsers.add_parser(
        'aggregate', aliases=['a'],
        help="""run the aggregrator""",
        description=Aggregator.__doc__)

    # auto
    parser_auto = subparsers.add_parser(
        'auto',
        help="""run auto task""",
        description="""Run a configured auto task.""")
    parser_auto.add_argument(
        'task', metavar='name', nargs='?', default='default',
        help="""the task name to run (default: %(default)s)""")

    return parser.parse_args(argv)


def main():
    args = parse_args()
    start_time = datetime.now()
    log.setLevel(args.verbosity)

    with open(args.config, 'rb') as fh:
        config = yaml.safe_load(fh)

    if args.action in ('lint', 'l'):
        params = inspect.signature(Linter).parameters
        kwargs = {k: getattr(args, k, params[k].default)
                  for k in ('files', 'check_regex', 'remove_empty', 'auto_fix', 'sort_rules', 'strip_eol')}
        Linter(args.root, config, **kwargs).run()

    elif args.action in ('uniquify', 'u'):
        params = inspect.signature(Uniquifier).parameters
        kwargs = {k: getattr(args, k, params[k].default)
                  for k in ('files', 'advanced', 'cross_files', 'auto_fix', 'auto_fix_excludes', 'strip_eol')}
        Uniquifier(args.root, config, **kwargs).run()

    elif args.action in ('build', 'b'):
        Builder(args.root, config).run()

    elif args.action in ('aggregate', 'a'):
        Aggregator(args.root, config).run()

    elif args.action == 'auto':
        # switch CWD so that passed paths in kwargs are resolved from root
        os.chdir(args.root)

        log.debug('Running auto task "%s" at %s ...', args.task, os.getcwd())
        try:
            tasks = config.get('auto_tasks', {})[args.task]
        except KeyError:
            log.error('Failed to run auto task "%s": task not found', args.task)
        else:
            for task in tasks:
                action = task.get('action')
                if action == 'lint':
                    cls = Linter
                elif action == 'uniquify':
                    cls = Uniquifier
                elif action == 'build':
                    cls = Builder
                elif action == 'aggregate':
                    cls = Aggregator
                else:
                    continue
                kwargs = task.get('kwargs', {})
                cls(args.root, config, **kwargs).run()

    log.debug('Time spent: %s', datetime.now() - start_time)


if __name__ == '__main__':
    main()
