#!/usr/bin/env python3
"""Check and publish blocklists for Content Farm Terminator."""
import argparse
import inspect
import logging
import os
import re
from contextlib import redirect_stdout
from datetime import datetime, timezone
from glob import iglob
from urllib.parse import quote

import yaml

logging.basicConfig(level=logging.INFO, format='%(levelname)s - %(message)s')
log = logging.getLogger(__name__)


RE_SPACE_MATCHER = re.compile(r'^(\S*)(\s*)(.*)$')
RE_DOMAIN_RULE = re.compile(r'^(?:[0-9a-z*-]+)(?:\.[0-9a-z*-]+)*$')
RE_SCHEME_RULE = re.compile(r'^([a-z][0-9a-z+.-]+):(.*)$')
RE_REGEX_RULE = re.compile(r'^/(.*)/([a-z]*)$')
RE_REGEX_SLASH_ESCAPER = re.compile(r'(\\.)|/')


def escape_regex_slash(text):
    """Escape "/"s in a (possibly escaped) regex."""
    return RE_REGEX_SLASH_ESCAPER.sub(lambda m: m.group(1) or r'\/', text)


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

        m = RE_REGEX_RULE.search(self.rule)
        if m:
            self.type = 'regex'
            self.pattern = m.group(1)
            self.flags = m.group(2)
            return

        m = RE_SCHEME_RULE.search(self.rule)
        if m:
            self.type = 'scheme'
            self.scheme = m.group(1)
            self.value = m.group(2)
            return

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
    def __init__(self, root, auto_fix=False, remove_empty=False, sort_rules=False):
        self.root = root
        self.auto_fix = auto_fix
        self.remove_empty = remove_empty
        self.sort_rules = sort_rules

    def run(self):
        for file in iglob(os.path.join(self.root, 'src', 'blocklist', '*.txt')):
            self.check_file(file)

    def check_file(self, file):
        log.debug('Checking %s ...', file)

        subpath = os.path.relpath(file, self.root)
        rules = []
        with open(file, encoding='UTF-8-SIG') as fh:
            for i, line in enumerate(fh):
                line = line.rstrip('\n')
                rule = Rule(line, path=subpath, line_no=i + 1)
                rules.append(rule)

        new_rules = []
        for rule in rules:
            if self.check_rule(rule):
                new_rules.append(rule)

        if self.sort_rules:
            new_rules.sort(key=lambda rule: f'{rule.rule}{rule.sep}{rule.comment}')

        if self.auto_fix and new_rules != rules:
            log.info('saving auto-fixed %s ...', subpath)
            with open(file, 'w', encoding='UTF-8') as fh:
                for rule in new_rules:
                    print(f'{rule.rule}{rule.sep}{rule.comment}', file=fh)

    def check_rule(self, rule):
        if rule.type is None:
            # A rule of None type should be empty; otherwise it has an invalid
            # format that cannot be recognized as another type.
            if rule.rule.strip():
                log.info('%s:%i: rule "%s" is invalid',
                         rule.path, rule.line_no, rule.rule)
                return False

            if self.remove_empty:
                if not rule.rule and not rule.comment:
                    log.info('%s:%i: rule is empty',
                             rule.path, rule.line_no)
                    return False

        elif rule.type == 'regex':
            try:
                re.compile(rule.rule)
            except re.error as exc:
                log.info('%s:%i: regex "%s" is invalid: %s',
                         rule.path, rule.line_no, rule.rule, exc)
                return False

        return True


class Uniquifier:
    """Check for duplicated rules of the source files."""
    def __init__(self, root, cross_files=False, auto_fix=False):
        self.root = root
        self.cross_files = cross_files
        self.auto_fix = auto_fix

    def run(self):
        rules = []
        for file in iglob(os.path.join(self.root, 'src', 'blocklist', '*.txt')):
            subpath = os.path.relpath(file, self.root)
            with open(file, encoding='UTF-8-SIG') as fh:
                for i, line in enumerate(fh):
                    line = line.rstrip('\n')
                    rule = Rule(line, path=subpath, line_no=i + 1)
                    rules.append(rule)

        if self.cross_files:
            new_rules = self.deduplicate_rules(rules)
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
        log.info('saving auto-fixed %s ...', subpath)
        file = os.path.join(self.root, subpath)
        with open(file, 'w', encoding='UTF-8') as fh:
            for rule in rules:
                print(f'{rule.rule}{rule.sep}{rule.comment}', file=fh)


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
        src_file = os.path.normpath(os.path.join(self.root, 'src', task['source']))
        dst_file = os.path.normpath(os.path.join(self.root, 'files', task['publish']))

        log.info('building "%s" from "%s" ...',
                 os.path.relpath(dst_file, self.root),
                 os.path.relpath(src_file, self.root))
        os.makedirs(os.path.dirname(dst_file), exist_ok=True)
        with open(src_file, 'r', encoding='UTF-8-SIG') as ih, \
             open(dst_file, 'w', encoding='UTF-8') as oh:
            with redirect_stdout(oh):
                converter = self.get_converter(task.get('type', 'cft'))
                converter(ih, task.get('data', {}), self.date).run()

    @staticmethod
    def to_uppercamelcase(text, delim='_'):
        """Convert delimited_text to UpperCamelCase."""
        return ''.join(w.title() for w in text.split(delim))

    @staticmethod
    def get_converter(name):
        converter = globals().get('Converter' + Builder.to_uppercamelcase(name))

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
        self.print_headers()

        scheme_groups = {}
        for line in self.fh:
            line = line.rstrip('\n')
            rule = Rule(line)

            # skip empty rule
            if rule.type is None:
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
            log.warning('rule "%s" has an undefined scheme', rule.rule)
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
                log.warning('escaper "%s" is not defined', escaper)
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
                log.warning('rule "%s" exceeds max length %i', rule.rule, scheme_max)
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
                        log.warning('rule "%s" exceeds max length %i', items[0][1].rule, scheme_max)
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

    def escape_url(self, value):
        return quote(value)


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
        # skip unsupported rules
        if not (
            rule.type == 'domain' and '*' not in rule.rule
            or rule.type == 'raw'
        ):
            return

        comment = '  # ' + re.sub(r'^\s*(?://|#)\s*', r'', rule.comment) if rule.comment else ''
        print(f'127.0.0.1 {rule.rule}{comment}')


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
        if rule.type == 'regex':
            regex = rule.rule
            print(f'{regex}$document')

        elif rule.type == 'domain':
            domain = rule.rule
            if '*' in domain:
                print(f'||{domain}^$document')
            else:
                print(f'||{domain}^')

        elif rule.type == 'raw':
            print(rule.rule)


class ConverterUblacklist(Converter):
    """Convert to an uBlacklist blocklist.

    https://github.com/iorate/ublacklist
    """
    def print_rule(self, rule):
        comment = '  # ' + re.sub(r'^\s*(?://|#)\s*', r'', rule.comment) if rule.comment else ''

        if rule.type == 'regex':
            print(f'/{escape_regex_slash(rule.pattern)}/{rule.flags}{comment}')

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


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.set_defaults(
        root=os.path.normpath(os.path.join(__file__, '..', '..')),
        verbosity=logging.INFO)
    parser.add_argument(
        '--root',
        help="""root directory to manipulate (default: %(default)s)""")
    parser.add_argument(
        '-q', '--quiet', dest='verbosity', action='store_const', const=logging.WARNING,
        help="""show only warnings or errors""")
    parser.add_argument(
        '-v', '--verbose', dest='verbosity', action='store_const', const=logging.DEBUG,
        help="""show debug information""")

    subparsers = parser.add_subparsers(
        metavar='ACTION', dest='action',
        help="""the action to run (default: lint and build)""")

    # lint
    parser_lint = subparsers.add_parser(
        'lint',
        help="""run the linter""",
        description=Linter.__doc__)
    parser_lint.add_argument(
        '-a', '--auto-fix', action='store_true', default=False,
        help="""automatically fix issues""")
    parser_lint.add_argument(
        '-s', '--sort-rules', action='store_true', default=False,
        help="""sort rules alphabetically""")
    parser_lint.add_argument(
        '-r', '--remove-empty', action='store_true', default=False,
        help="""remove empty lines""")

    # uniquify
    parser_uniquify = subparsers.add_parser(
        'uniquify',
        help="""run the uniquifier""",
        description=Uniquifier.__doc__)
    parser_uniquify.add_argument(
        '-c', '--cross-files', action='store_true', default=False,
        help="""check for uniquity across files""")
    parser_uniquify.add_argument(
        '-a', '--auto-fix', action='store_true', default=False,
        help="""automatically fix issues""")

    # build
    subparsers.add_parser(
        'build',
        help="""run the builder""",
        description=Builder.__doc__)

    return parser.parse_args(argv)


def main():
    args = parse_args()
    log.setLevel(args.verbosity)

    config_file = os.path.join(args.root, 'src', 'config.yaml')
    with open(config_file, 'rb') as fh:
        config = yaml.safe_load(fh)

    if args.action in ('lint', None):
        params = inspect.signature(Linter).parameters
        kwargs = {k: getattr(args, k, params[k].default)
                  for k in ('auto_fix', 'sort_rules', 'remove_empty')}
        Linter(args.root, **kwargs).run()

    if args.action == 'uniquify':
        params = inspect.signature(Uniquifier).parameters
        kwargs = {k: getattr(args, k, params[k].default)
                  for k in ('cross_files', 'auto_fix')}
        Uniquifier(args.root, **kwargs).run()

    if args.action in ('build', None):
        Builder(args.root, config).run()


if __name__ == '__main__':
    main()
