#!/usr/bin/env python3
"""Check and publish blocklists for Content Farm Terminator."""
import argparse
import logging
import math
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
    def __init__(self, root, auto_fix=False):
        self.root = root
        self.auto_fix = auto_fix

    def run(self):
        for file in iglob(os.path.join(self.root, 'src', 'blocklist', '*.txt')):
            self.check_file(file)

    def check_file(self, file):
        log.debug('Checking %s ...', file)

        subpath = os.path.relpath(file, self.root)
        rules = []
        with open(file, encoding='UTF-8-SIG') as fh:
            i = 0
            for line in fh:
                i += 1
                line = line.rstrip('\n')
                rule = Rule(line, path=subpath, line_no=i)
                rules.append(rule)

        new_rules = []
        for rule in rules:
            if self.check_rule(rule):
                new_rules.append(rule)

        new_rules = self.deduplicate_rules(new_rules)
        new_rules = self.check_covered_rules(new_rules)
        # new_rules.sort(key=lambda rule: f'{rule.rule}{rule.sep}{rule.comment}')

        if self.auto_fix and new_rules != rules:
            log.info('saving auto-fixed %s ...', subpath)
            with open(file, 'w', encoding='UTF-8-SIG') as fh:
                for rule in new_rules:
                    print(f'{rule.rule}{rule.sep}{rule.comment}', file=fh)

    def check_rule(self, rule):
        if rule.type is None:
            if rule.rule.strip():
                log.info('%s:%i: rule "%s" is invalid',
                         rule.path, rule.line_no, rule.rule)
                return False

            elif not rule.rule and not rule.comment:
                log.info('%s:%i: rule "%s" is empty',
                         rule.path, rule.line_no, rule.rule)
                return False

        elif rule.type == 'regex':
            try:
                re.compile(rule.rule)
            except re.error as exc:
                log.info('%s:%i: regex "%s" is invalid: %s',
                         rule.path, rule.line_no, rule.rule, exc)
                return False

        return True

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
                    log.info('%s:%i: rule "%s" duplicates rule "%s" (:%i)',
                             rule.path, rule.line_no, rule.rule, rule2.rule, rule2.line_no)
                    continue
            new_rules.append(rule)

        return new_rules

    def check_covered_rules(self, rules):
        new_rules = []

        regex_dict = {}
        for rule in rules:
            if rule.type == 'domain':
                regex_dict[rule] = re.compile(
                    r'^([\w*-]+\.)*'
                    + rule.rule.replace(r'*', r'[\w*-]').replace(r'.', r'\.')
                    + '$')

        for rule in rules:
            ok = True
            if rule.type == 'domain':
                for rule2 in rules:
                    if rule2.line_no == rule.line_no:
                        continue

                    try:
                        regex = regex_dict[rule2]
                    except KeyError:
                        continue

                    if regex.search(rule.rule):
                        log.info('%s:%i: domain "%s" is covered by rule "%s" (:%i)',
                                 rule.path, rule.line_no, rule.rule, rule2.rule, rule2.line_no)
                        ok = False
                        continue

            if ok:
                new_rules.append(rule)

        return new_rules


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
    allow_scheme = True

    def __init__(self, fh, info, date):
        self.fh = fh
        self.info = info
        self.date = date

    def run(self):
        self.print_info()

        schemes = self.info.get('schemes', {})
        scheme_groups = {}
        for line in self.fh:
            line = line.rstrip('\n')
            rule = Rule(line)

            # skip empty rule
            if rule.type is None:
                continue

            # apply preprocessors, which modifies the rule content
            new_rule = self.process_rule(rule, self.info.get('preprocessors', []))
            if new_rule is not None:
                rule.set_rule(new_rule)

            # apply processors, which forcely defines the raw output rule
            new_rule = self.process_rule(rule, self.info.get('processors', []))
            if new_rule is not None:
                rule.set_rule_raw(new_rule)

            # special handling for a scheme rule, which forcely defines the raw output rule
            if self.allow_scheme and rule.type == 'scheme':
                scheme = schemes.get(rule.scheme)

                if scheme is None:
                    log.warning('rule "%s" has an undefined scheme', rule.rule)
                    continue

                # determine the value, which may be pre-modified by escapers
                value = rule.value
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

                if not value:
                    continue

                # special handling for grouping rules
                if scheme.get('grouping'):
                    scheme_groups.setdefault(rule.scheme, []).append(value)
                    continue

                value = scheme.get('value', '').format(value=value)

                scheme_max = scheme.get('max')
                if scheme_max is not None and len(value) > scheme_max:
                    log.warning('rule "%s" exceeds max length %i', rule.rule, scheme_max)
                    continue

                rule.set_rule_raw(value)

            self.print_rule(rule)

        # output grouping scheme rules
        def get_joined_value(pos=None):
            value = scheme_sep.join(values[i] for i in range(pos))
            value = scheme_value.format(value=value)
            return value

        def bsearch(values):
            # test if all values can fit
            pos = len(values)
            value = get_joined_value(pos)
            if len(value) <= scheme_max:
                return pos, value

            # binary search to get the max pos that fits
            pos_max = pos - 1
            pos_min = 0
            while pos_min != pos_max:
                pos = math.ceil((pos_max + pos_min) / 2)
                value = get_joined_value(pos)
                if len(value) <= scheme_max:
                    pos_min = pos
                else:
                    pos_max = pos - 1

            pos = pos_min
            if pos > 0:
                return pos, get_joined_value(pos)
            else:
                return pos, None

        for scheme_group, values in scheme_groups.items():
            scheme = schemes[scheme_group]
            scheme_value = scheme.get('value', '')
            scheme_sep = scheme['grouping']
            scheme_max = scheme.get('max')

            if scheme_max is not None:
                outputs = []
                while values:
                    pos, value = bsearch(values)
                    if pos > 0:
                        outputs.append(value)
                        values = values[pos:]
                    else:
                        log.warning('rule "%s:%s" exceeds max length %i', scheme_group, values[0], scheme_max)
                        values = values[1:]

            else:
                outputs = [get_joined_value()]

            for output in outputs:
                print(output)

    def process_rule(self, rule, processors):
        """Process a rule.

        Returns:
            *: the new rule string or None if not processed
        """
        text = rule.rule
        for pp in processors:
            if pp.get('type') in (rule.type, None):
                find = pp.get('find')
                regex = re.compile(pp.get('pattern', ''))
                if regex.search(text) if find is None else find in text:
                    new_rule = regex.sub(pp.get('replacement', ''), text)
                    return new_rule

        return None

    def print_info(self):
        pass

    def print_rule(self, rule):
        print(rule.rule + rule.sep + rule.comment)

    def escape_regex(self, value):
        return re.escape(value)

    def escape_url(self, value):
        return quote(value)


class ConverterCft(Converter):
    """Convert to a canonical Content Farm Terminator blocklist."""
    def print_rule(self, rule):
        print(f'{rule.rule}{" " + rule.comment if rule.comment else ""}')


class ConverterHosts(Converter):
    r"""Convert to the hosts file format.

    Common system paths:
    - Windows: %SystemRoot%\System32\drivers\etc\hosts
    - *nix: /etc/hosts
    """
    allow_scheme = False

    def print_info(self):
        for field in ('Title', 'Description', 'Expires', 'Last modified', 'Homepage', 'Licence'):
            if self.info.get(field):
                print(f'# {field}: {self.info[field]}')

            elif field == 'Last modified':
                lm = self.date.astimezone(timezone.utc).isoformat(timespec='seconds')
                print(f'# {field}: {lm}')

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
    def print_info(self):
        for field in ('Title', 'Description', 'Expires', 'Last modified', 'Homepage', 'Licence'):
            if self.info.get(field):
                print(f'! {field}: {self.info[field]}')

            elif field == 'Last modified':
                lm = self.date.astimezone(timezone.utc).isoformat(timespec='seconds')
                print(f'! {field}: {lm}')

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
        help="""the action to run (default: do all)""")

    # lint
    parser_lint = subparsers.add_parser(
        'lint',
        help="""run the linter""",
        description=Linter.__doc__)
    parser.set_defaults(auto_fix=False)
    parser_lint.add_argument(
        '-a', '--auto-fix', action='store_true',
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
        Linter(args.root, auto_fix=args.auto_fix).run()

    if args.action in ('build', None):
        Builder(args.root, config).run()


if __name__ == '__main__':
    main()
