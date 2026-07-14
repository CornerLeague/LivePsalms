# Apple Notes Import — Runbook

Lets users bring their Apple Notes into the Psalms notepad via an Apple Shortcut
that POSTs each note to the `import-apple-note` edge function, authenticated by a
personal access token (PAT).

## User setup
1. In Psalms → Settings → **Connect Apple Notes**, tap **Generate token** and
   copy the `psalms_pat_…` value (shown once).
2. On an iPhone, iPad, or Mac, tap **Install Shortcut** in the same panel (it opens
   the iCloud Shortcut link directly in the Shortcuts app). If Shortcuts isn't
   installed, use **Get the Shortcuts app** to install it first.
3. Run the Shortcut. It shows a one-tap menu — **Import all notes** or
   **Choose a folder** — then imports everything with no per-note tapping. On the
   first run it asks for your token; paste the value you copied.
4. Back in the panel, the status banner confirms imports ("✅ N notes imported ·
   last import …") once a run completes.

> The panel is platform-aware: on a non-Apple browser it shows a "needs an Apple
> device" note but still lets you generate a token to use on your Apple device.
> The raw endpoint URL is no longer shown — it's baked into the distributed Shortcut.

## Shortcut recipe (build once, distribute as an iCloud link)

The recipe is **menu-driven and tap-free**: the user chooses scope **once**
(all notes, or one folder) and every matching note imports with **no per-note
picker**. Removing the old `Choose from List` per-note step is the whole point —
it is what made the user tap through notes one by one.

1. **Ask for Input** (Text) → prompt `Paste your Psalms token (psalms_pat_…)` →
   **Set Variable** `token`. *(First-run prompt. To make repeat runs one tap, see
   the token-storage note below.)*
2. **Text** → the import endpoint
   `https://<project-ref>.functions.supabase.co/import-apple-note`
   (or `${VITE_SUPABASE_URL}/functions/v1/import-apple-note`) → **Set Variable** `endpoint`.
3. **Choose from Menu** with two items:
   - **Import all notes** → **Find Notes** with **no folder filter** (every note).
   - **Choose a folder** → **Find Notes** → **Add Filter → Folder → is → Ask Each Time**
     (the user picks one folder at run time).
   There is **no** `Choose from List` per-note picker in either branch.
4. **Repeat with Each** over the found notes. Inside the loop, the current note is the
   **Repeat Item** variable (the Note type exposes **Name, Summary, Body, Folder, Tags** —
   no dates, which is why the server keys off content):
   - Repeat Item → **Name** → **Set Variable** `noteTitle`.
   - Repeat Item → **Body** → **Set Variable** `noteText`.
   - Repeat Item → **Folder** → **Set Variable** `folderName`. *(Read the folder from the
     note itself — this is defined in **both** menu branches: **Import all notes** preserves
     each note's own Apple Notes folder, and **Choose a folder** resolves to the folder the
     user picked. A note with no named folder yields an empty value, which the server files
     directly under the root **Apple Notes** folder.)*
   - **Get Contents of URL** (input = `endpoint`):
     - Method: `POST`
     - Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`
     - Request Body: JSON →
       `{ "title": noteTitle, "text": noteText, "folder_name": folderName }`
5. **Show Notification** after the loop with a count of `created` + `unchanged`
   responses (e.g. "Imported N notes").

The endpoint returns `{ status: "created" | "unchanged", note_id }` per note.

**Token-storage note.** The steps above prompt for the token **every run** (safest for
a link you share with others, so no one inherits your token). For your **own personal**
copy, storing the token once is much nicer: replace step 1 (Ask for Input + Set Variable)
with a single **Text** action holding your `psalms_pat_…` value + **Set Variable** `token`
— no prompt on future runs. Keep the shared/distributed link on Ask-for-Input; switch only
your personal copy to stored.

> **Why no dates?** Apple Shortcuts cannot read a note's id or its creation/
> modification dates (the Note variable only exposes Name, Summary, Body, Folder,
> Tags). So the server identifies a note by a **hash of its title + body**, not by
> date. Sending `created_at`/`modified_at` is unnecessary (and they'd be empty).

## Building the Shortcut step by step (maintainer, one-time)

Build this once in the **Shortcuts app** (easiest on a Mac, also works on iPhone/iPad),
test it, then share it as an iCloud link. Each numbered step is one action you add by
searching the action list and dragging it in, in order.

**Prep:** Shortcuts → **File ▸ New Shortcut** (Mac) or **+** (iOS). Name it
`Import Apple Notes`. It runs standalone (Share Sheet not needed).

1. **Ask for Input** → Input type **Text**, prompt `Paste your Psalms token (psalms_pat_…)`.
   Then **Set Variable** `token`.
   *(To store the token instead of prompting: replace these two with one **Text** action
   holding the token + **Set Variable** `token`. Recommended only for your personal copy —
   see the token-storage note above.)*

2. **Text** → the endpoint URL exactly:
   `https://<project-ref>.functions.supabase.co/import-apple-note`
   Then **Set Variable** `endpoint`. *(Replace `<project-ref>` before sharing.)*

3. **Choose from Menu** (search "Choose from Menu"). Set two menu items:
   **Import all notes** and **Choose a folder**. This creates two branches — put the
   matching **Find Notes** action inside each:
   - Under **Import all notes** → **Find Notes** with **no filter** (all notes).
   - Under **Choose a folder** → **Find Notes** → **Add Filter → Folder → is**, then tap the
     folder value and pick **Ask Each Time** so the user chooses a folder at run time.
   Leave **Sort by** / **Limit** off in both. **Do not** add a `Choose from List` action —
   the tap-free import is the point.

4. **Repeat with Each** (search "Repeat with Each"), passed the **Notes** output of the
   branch you're in. (Simplest: end both menu branches by setting a shared `notes` variable,
   then place one **Repeat with Each** over `notes` after the menu.) Everything below goes
   *inside* the Repeat block. The current note is the **Repeat Item** variable.

   There is **no** "Get Details of Notes" action. To read a field, insert **Repeat Item**
   and click the token to choose the detail (Name, Summary, Body, Folder, Tags — **no dates**).

   4a. **Text** → insert **Repeat Item** → choose **Name** → **Set Variable** `noteTitle`.

   4b. **Text** → insert **Repeat Item** → choose **Body** → **Set Variable** `noteText`.

   4c. **Text** → insert **Repeat Item** → choose **Folder** → **Set Variable** `folderName`.
       This is what groups the imports, and reading it **from the note** (not from the step-3
       menu) is what makes **Import all notes** work: every note supplies its own folder, so
       there is no undefined value in the all-notes branch. In the **Choose a folder** branch
       it equals the folder the user picked. A note with no named folder yields empty, and the
       server files it directly under the root **Apple Notes** folder.

   4d. **Get Contents of URL**, input = the `endpoint` variable. **Show More** and set:
       - **Method:** `POST`
       - **Headers:** `Authorization` = `Bearer ` then the `token` variable;
         `Content-Type` = `application/json`
       - **Request Body: JSON**, add fields (Type = Text): `title` = `noteTitle`,
         `text` = `noteText`, `folder_name` = the `folderName` variable from 4c.

   4e. *(Optional)* **Get Dictionary Value** → key `status` from the **Contents of URL**
       output → **Add to Variable** `results` to tally outcomes.

5. *(After End Repeat)* **Show Notification** (or **Show Result**) with the `results` count
   so the user sees how many notes were created/unchanged.

**Test before sharing:** run against a small test folder (2–3 notes) via **Choose a folder**,
then via **Import all notes**. First run reports `created`; an immediate re-run reports
`unchanged`. (Editing a note's text then re-running imports it as a *new* note — identity is
the title+body hash; see Behaviour.) Confirm the notes appear under **Apple Notes › <folder>**
in the Psalms notepad.

**Distribute:** Shortcuts → right-click → **Share** → **Copy iCloud Link** (enable iCloud
sharing if prompted). Put that link in the Settings → Connect Apple Notes panel constant
(`APPLE_SHORTCUT_ICLOUD_URL`) and in the "User setup" section above. Anyone with the link
installs it in one tap; on first run it prompts for their own token.

> Note: a Shortcut is authored in Apple's GUI and lives as a `.shortcut` file in
> iCloud, not as code in this repo. These instructions are the source of truth for
> rebuilding it; there is no file to commit here beyond this runbook.

## Behaviour
- Imported notes land in an auto-created **Apple Notes** folder (a named subfolder
  when `folder_name` is sent), with `type = general`. Because the Shortcut sends each
  note's own folder, an **Import all notes** run mirrors your Apple Notes folders as
  subfolders under **Apple Notes**; notes with no named folder sit directly in it. The
  note's date in Psalms is its import time (Apple's original dates are not available to
  Shortcuts).
- **Dedup key = SHA-256 of `title|body`** (the note's content). Re-running is safe:
  an unchanged note returns `unchanged` and is not re-inserted.
  - Two notes with the *same title AND same body* are treated as one.
  - A note **edited** in Apple Notes hashes differently, so it imports as a **new**
    note (the previous version remains; the server never overwrites a different note).
    If you re-import frequently after edits, expect extra copies — delete stale ones in
    Psalms.
- Statuses: `created` (new) or `unchanged` (identical content already imported). There
  is no `updated` status — see the edit behaviour above.
- Rate limit: 600 requests/hour per token (HTTP 429 beyond that).

## Deployment (run by a maintainer)
1. Apply the migration (NOT in CI — manual):
   `supabase db push` (against the linked project).
2. Deploy the function (NOT carried by a frontend/Vercel deploy):
   `supabase functions deploy import-apple-note --use-api`
3. Confirm `config.toml` pushed `verify_jwt = false` for `import-apple-note`.
   **Review the push diff** — a config push can clobber the whole `[auth]` block.
4. Ensure `ALLOWED_ORIGINS` is unchanged (CORS is irrelevant to the Shortcut, but
   the shared helper still reads it).

## Revocation
Settings → Connect Apple Notes → **Revoke** sets `revoked_at`; the next Shortcut
run gets HTTP 401.
