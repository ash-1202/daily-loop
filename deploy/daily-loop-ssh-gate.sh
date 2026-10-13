#!/bin/sh
# Forced command for the "deploy" user's SSH key (see authorized_keys in deploy/README.md).
# Whatever the client asks to run arrives in $SSH_ORIGINAL_COMMAND; the only thing allowed is
#
#   deploy <40-char commit sha>
#
# which runs the root-owned deploy script through one narrow sudo rule. No shell, no other
# commands, no arguments with spaces or symbols.
# Installed as /usr/local/bin/daily-loop-ssh-gate (root-owned, not writable by "deploy").
set -eu

case "${SSH_ORIGINAL_COMMAND:-}" in
  deploy\ *)
    sha=${SSH_ORIGINAL_COMMAND#deploy }
    # Exactly 40 characters, every one of them 0-9 or a-f. (Not grep: it matches line by line,
    # so "<sha><newline>anything" would pass.)
    case "$sha" in
      *[!0-9a-f]*) ;;
      *) [ "${#sha}" -eq 40 ] && exec sudo -n /usr/local/bin/deploy-daily-loop "$sha" ;;
    esac
    ;;
esac

echo "Not allowed. This key can only run: deploy <40-char commit sha>" >&2
exit 2
