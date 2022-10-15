# System requirements:
# * OS: *nix
# * zip
#
# Steps:
# * Adjust $filename variable to fit your needs.
# * Run this script, and the packed files are created in the ../dist directory.
#
#
filename="content-farm-terminator"
dir=$(dirname $(realpath "$0"))
src=$(realpath "$dir/../src")
dist=$(realpath "$dir/../dist")
cd "$src"

# Chrome extension package (for submit)
fn="$filename.zip" &&
rm -f "$dist/$fn" &&
zip -r "$dist/$fn" * -x '.git*' -x 'aggregations/*' &&
zip -d "$dist/$fn" 'manifest-firefox.json'

# Firefox addon
fn="$filename.xpi" &&
rm -f "$dist/$fn" &&
zip -r "$dist/$fn" * -x '.git*' -x 'aggregations/*' &&
zip -d "$dist/$fn" 'manifest.json' &&
printf "@ manifest-firefox.json\n@=manifest.json\n" | zipnote -w "$dist/$fn"
