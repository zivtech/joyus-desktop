# Recon Operator Setup Runbook

> For Alex to follow during onboarding video call with Aaron.
> Aaron is non-technical. Steps that require a terminal are labeled "terminal required" — Alex runs these on Aaron's machine via screen share or SSH.

---

## Prerequisites

Before the call, confirm:

- Mac (Apple Silicon or Intel), macOS 13 Ventura or later
- 4 GB free disk space minimum (`Apple menu > About This Mac > More Info > Storage`)
- Stable internet connection for credential verification
- Aaron's Signal contact for secure credential delivery
- Alex has the Joyus Desktop `.dmg` file and the `joyus-recon.md` skill file ready to send

---

## Step 1: Install Claude Code (terminal required)

Alex runs this on Aaron's machine (share screen or SSH) or walks Aaron through copy-pasting into Terminal.
The Setup Wizard (Step 5.1) will auto-detect Claude Code; if it is not installed, the wizard blocks.

```bash
npm install -g @anthropic-ai/claude-code
```

**Verification:**

```bash
claude --version
```

Expected output: a version string like `claude-code/1.x.x`. If it errors, confirm Node.js 18+ is installed:

```bash
node --version
```

If Node is missing, install from [nodejs.org](https://nodejs.org) (LTS release), then retry.

---

## Step 2: Deliver the DMG

**Option A — AirDrop (preferred for same-network calls):**
1. Alex right-clicks the `.dmg` file on his Mac and chooses Share > AirDrop
2. Aaron accepts the incoming file in the AirDrop notification

**Option B — Time-limited Google Drive link:**
1. Alex uploads the `.dmg` to Google Drive
2. Sets sharing to "Anyone with the link, Viewer"
3. Sends the link via Signal
4. Aaron opens the link and clicks Download

Aaron: once the file downloads, find it in your Downloads folder. Do not open it yet — proceed to Step 3.

---

## Step 3: Install the Unsigned App (Aaron)

Phase 1 of Joyus Desktop ships unsigned. macOS will show a Gatekeeper warning. This is expected.

**Option A — System Settings (Aaron does this, no terminal needed):**
1. Drag `JoyusDesktop.dmg` to open it (double-click)
2. Inside the mounted disk image, drag the `JoyusDesktop` icon into the `Applications` folder shortcut
3. Open `Applications`, right-click `JoyusDesktop`, choose **Open**
4. macOS shows: "JoyusDesktop cannot be opened because the developer cannot be verified"
5. Click **Done** (do not click "Move to Trash")
6. Go to: `System Settings > Privacy & Security`
7. Scroll down to the Security section — you will see: "JoyusDesktop was blocked from use…"
8. Click **Open Anyway**
9. Authenticate with your Mac password or Touch ID

**Option B — Terminal fallback (Alex runs remotely if Option A fails):**

```bash
xattr -d com.apple.quarantine /Applications/JoyusDesktop.app
```

Then launch normally from Applications.

---

## Step 4: Launch Desktop

Double-click `JoyusDesktop` in Applications. The first launch opens the **Setup Wizard**. Do not skip any step.

---

## Step 5: Complete Setup Wizard

Work through each wizard step in order. If any step shows a red indicator, do not proceed — resolve it first.

### Step 5.1 — Claude Code Detection

The wizard auto-detects Claude Code. Expected result: green check.

- **Green check**: proceed to Step 5.2
- **Red X**: Claude Code is not in PATH. Go back to Step 1. After reinstalling, return to the wizard and click **Check Again**.

### Step 5.2 — Credentials

Alex sends each credential individually via Signal, one at a time. Aaron types it into the labeled field and clicks **Save** before Alex sends the next one.

**Important**: Watch for trailing spaces when copying from Signal. If verification fails, delete the field contents and retype from scratch.

**Required credentials (in order):**

| # | Credential | Source |
|---|-----------|--------|
| 1 | Anthropic API Key | Anthropic Console (Alex's account) |
| 2 | DataForSEO Username | DataForSEO dashboard (Alex's account) |
| 3 | DataForSEO Password | DataForSEO dashboard (Alex's account) |
| 4 | CrUX API Key | Google Cloud Console (Alex's project) |

After all four are saved, click **Verify All**.

- **All green checks**: proceed to Step 5.3
- **Any red X**: re-enter that credential (watch for leading/trailing whitespace), save, and click **Verify All** again

### Step 5.3 — Skill File

The wizard needs the `joyus-recon.md` skill file at `~/.claude/skills/joyus-recon.md`.

**Alex transfers the file (one of two options):**

**Option A — AirDrop:**
1. Alex right-clicks `~/.claude/skills/joyus-recon.md` and shares via AirDrop to Aaron
2. Aaron saves to Downloads
3. Aaron opens Terminal, runs:
   ```bash
   mkdir -p ~/.claude/skills && cp ~/Downloads/joyus-recon.md ~/.claude/skills/
   ```

**Option B — scp (Alex runs, Aaron's IP must be accessible):**
```bash
scp ~/.claude/skills/joyus-recon.md aaron@<ip>:~/.claude/skills/joyus-recon.md
```

After the file is in place, click **Check Again** in the wizard.

- **Green check**: proceed to Step 6
- **Red X**: confirm file was saved to the correct path (`~/.claude/skills/joyus-recon.md`, not `~/Downloads/`)

---

## Step 6: Run Test Engagement

Run a short engagement against a public site to confirm the full pipeline works end-to-end.

1. Click **New Engagement**
2. Fill in the form:
   - **Client Name**: `Test Run`
   - **URL**: `https://zivtech.com`
   - **Access Mode**: `RFP` (limited — no authenticated crawl, no internal docs)
3. Click **Start Engagement**
4. Watch the progress log in the right panel — updates should appear within 30 seconds
5. Full run takes 3–10 minutes depending on connection speed
6. When the status shows **Complete**:
   - Click **Scan Output** — wait for the scan banner
   - Expected result: **green PASS banner** ("Sensitive output scan passed")
   - Click **Export**
   - Note the file path shown in the export confirmation dialog (e.g., `~/Documents/joyus-recon-engagements/exports/test-run.zip`)
7. Aaron confirms he can locate the zip file in Finder

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Wizard Step 1 shows red X | Claude Code not installed or not in PATH | Install via `npm install -g @anthropic-ai/claude-code` (terminal required), then click **Check Again** |
| Wizard Step 2 "Verify All" shows red X | Credential copied with leading/trailing whitespace | Delete the field, retype manually, click Save, then Verify All |
| Progress log is empty after 30 seconds | Sidecar process failed to start | Force-quit the app (Cmd+Q), relaunch, try again |
| Progress log shows error message | API key rejected or network error | Check the specific error text; if "401 Unauthorized", re-enter the relevant credential |
| Status stuck more than 15 minutes | Engagement process hung | Click **Cancel**, wait 5 seconds, click **Start Engagement** again |
| Scan shows red FAIL banner | Generated content matched a sensitive-data rule | Click **Override** (acceptable for dogfood), note the finding for Alex to review; Alex may need to update scan rules for false positives |
| Export fails with error | Disk space too low | Check available space (`df -h ~`); need at least 500 MB free |
| App crashes on launch | Quarantine attribute still set | Alex runs: `xattr -d com.apple.quarantine /Applications/JoyusDesktop.app` |
| Skill file shows red X after copying | File saved to wrong path | Confirm file is at `~/.claude/skills/joyus-recon.md` (not in Downloads or Desktop) |

---

## After the Call

- Alex confirms Aaron can locate the exported zip and send it (e.g., via Slack or AirDrop)
- Alex reviews the zip contents and any scan findings Aaron noted
- Alex updates `resources/scan-sensitive-output.mjs` exclusion rules for any confirmed false positives
- Alex logs the session outcome in the dogfood tracking doc

---

## Reference: Credential Storage

Credentials are stored in two locations:

1. **macOS Keychain** (primary, service: `com.joyus.desktop-companion`) — persists across app restarts; populated by one-time migration from the flat file on launch.
2. **Flat file** (written by the Setup Wizard) at:
   ```
   ~/Library/Application Support/com.joyus.desktop-companion/credentials.env
   ```
   Set to permission `600` (owner read/write only).

When launching an engagement, the app merges both sources: keychain values first, then flat-file values overlaid (flat-file wins on conflict, since the Setup Wizard writes there directly). This ensures rotated credentials take effect immediately without requiring an app restart.

Credentials are:
- Never included in engagement exports
- Never transmitted off-device (used locally to authenticate API calls)

If credentials need to be rotated, Aaron can re-open the Setup Wizard from the app menu (`Joyus Desktop > Setup Wizard`) and re-enter each credential.
