# deploy/

Canonical systemd unit templates for the surfagent fleet on BLD (Jeff's Linux
workstation). Vendored here so a fresh OS install can restore the 5-instance
Chrome CDP fleet without reverse-engineering the per-instance config.

## Why vendored

These units encode BLD-specific paths (fnm node 22 install dir, GDM display,
DBus session bus) — they are NOT generic upstream artifacts and should not be
PR'd into `mostlygeek/surfagent`. They live in the `Jeffdotchan/surfagent`
fork as installation reference for this fork's operator.

History: the unit template existed ONLY at
`~/.config/systemd/user/surfagent@.service` on BLD prior to 2026-05-22. The
Zorin OS 18.1 reinstall that day recovered it via home-dir rsync; if the
backup had been incomplete the 5-instance fleet config would have been lost.
This vendoring closes that gap. See vault note
`[[BLD OS Reinstall Recovery (2026-05-22)]]` for the full incident.

## Files

- `surfagent@.service` — main user-scope systemd template (one process per
  instance: a, b, c, d, e). Defaults `DISPLAY=:0` (Zorin 18.1 GDM).
- `surfagent-watch@.service` — download-watcher sibling unit, `BindsTo` the
  parent surfagent instance.
- `instance.env.example` — copy to `~/.config/surfagent/instance-<id>.env`
  and edit ports + chrome dir per instance.

## Install (fresh BLD)

```bash
# 1. Install node 22 + surfagent binary via fnm + npm
fnm install 22
fnm use 22
npm install -g surfagent      # or: npm install -g Jeffdotchan/surfagent for the stealth fork

# 2. Copy unit templates to the user-systemd dir
mkdir -p ~/.config/systemd/user ~/.config/surfagent
cp deploy/surfagent@.service       ~/.config/systemd/user/
cp deploy/surfagent-watch@.service ~/.config/systemd/user/

# 3. Author per-instance env files (one per fleet member)
for i in a b c d e; do
  cp deploy/instance.env.example ~/.config/surfagent/instance-$i.env
  # then edit CDP_PORT / API_PORT / CHROME_USER_DATA_DIR per the fleet table
done

# 4. Enable + start each instance
systemctl --user daemon-reload
for i in a b c d e; do
  systemctl --user enable --now surfagent@$i
  systemctl --user enable --now surfagent-watch@$i
done

# Verify all 5 are active and ports are bound
systemctl --user is-active surfagent@{a,b,c,d,e}
ss -tlnpH | awk '$4 ~ /:(3456|3500|3501|3502|3503)$/'
```

## Cross-links

- Obsidian vault: `[[BLD OS Reinstall Recovery (2026-05-22)]]`
- Obsidian vault: `[[reference_surfagent_fleet]]` (fleet allocation + ports)
- Obsidian vault: `[[reference_surfagent_dossier]]` (full operator dossier)
- jarvis-2nd-brain: `app_docs/bld_surfagent_tunnel.md` (Cloudflare ingress)
