#!/bin/sh
#
# Build-time verification of the font bindings.
#
# Why check at build rather than leaving it to the tests: the failure mode of a broken font
# binding is a silent fallback to a different font. That raises no error and turns no
# assertion red — it just builds every subsequent geometric number on the wrong font, and
# the three browsers may fall back to different places, so the cross-browser comparison
# starts lighting up red for reasons unrelated to frond's code. Better to blow up here.
#
# This script also answers a question that was still unconfirmed when issue #3 was opened:
# whether Ubuntu's fonts-noto-cjk actually covers Noto Serif CJK. The package description
# only says "CJK regular and bold" and says nothing about the Sans / Serif split. If it does
# not cover it, the first group of assertions below fails rather than letting serif fall back
# silently.

set -eu

failed=0

report_failure() {
    echo "  ✗ $1"
    echo "      expected to contain: $2"
    echo "      actually resolved:   $3"
    failed=1
}

# Asserts that a fontconfig pattern resolves to the expected face.
assert_face() {
    pattern="$1"
    expected="$2"

    actual="$(fc-match --format='%{family}' "$pattern")"

    case "$actual" in
        *"$expected"*)
            echo "  ✓ $pattern → $actual"
            ;;
        *)
            report_failure "$pattern" "$expected" "$actual"
            ;;
    esac
}

echo "frond font binding verification"
echo

echo "default resolution of the generic families (no lang information)"
assert_face 'serif'      'Noto Serif CJK TC'
assert_face 'sans-serif' 'Noto Sans CJK TC'
echo

echo "regional face resolution by lang"
assert_face 'serif:lang=ja'         'Noto Serif CJK JP'
assert_face 'sans-serif:lang=ja'    'Noto Sans CJK JP'
assert_face 'serif:lang=zh-tw'      'Noto Serif CJK TC'
assert_face 'sans-serif:lang=zh-tw' 'Noto Sans CJK TC'
assert_face 'serif:lang=zh-cn'      'Noto Serif CJK SC'
assert_face 'sans-serif:lang=zh-cn' 'Noto Sans CJK SC'
echo

if [ "$failed" -ne 0 ]; then
    cat <<'EOF'

Font binding verification failed.

The Noto CJK faces actually installed in the image are listed below, to compare against the
"actually resolved" values above:

EOF
    fc-list : family | tr ',' '\n' | grep -i 'noto.*cjk' | sort -u | sed 's/^/  /'

    cat <<'EOF'

Common causes and what to do:

  * No Noto Serif CJK in the list at all
    → this version of fonts-noto-cjk does not cover Serif. Noto Serif CJK has to be obtained
      separately and pinned to a version the same way. serif must not be allowed to fall back
      silently to another font (issue #3).

  * The face names in the list differ from what is expected (a different regional suffix, or
    a switch to variable-font naming)
    → Noto CJK's distribution form has changed across versions. Update
      docker/fontconfig/10-frond-cjk.conf and the expectations in this file against the actual
      names, and record the version-to-name correspondence in the commit message.

  * The names are all there, but serif / sans-serif land on a Latin font (Noto Serif, DejaVu
    Serif, …)
    → the conf.d filename ordering has been overridden. Both the base image's 60-latin.conf
      and the 70-fonts-noto-cjk.conf that ships with fonts-noto-cjk touch the same generic
      families, and this project's configuration file has to come after both (currently 75).

  * The names are all there, but the lang-specific regional face does not take effect (lang=ja
    yields TC, say)
    → the rule order inside the file is reversed. mode="prepend" does not insert at the front
      of the list, it inserts before the value the <test> matched, so a rule applied later ends
      up further back — an earlier-applied rule has higher priority. Language specializations
      have to be written before the general rules.

      Use `fc-pattern -c "serif:lang=ja"` to see the full family list after the configuration
      is applied; it shows what is ordered before what more clearly than fc-match does.

EOF
    exit 1
fi

echo "Font binding verification passed."
