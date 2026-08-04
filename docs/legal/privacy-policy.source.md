# LivePsalms Privacy Policy

**Effective Date**: May 28, 2026
**Last Updated**: May 28, 2026

---

## Our Privacy Commitment

Welcome to LivePsalms. We provide a faith-based, interconnected note-taking platform designed for Christian devotional practices, sermon listening, and thematic Bible study. Our services include an optional AI-powered feature suite called "Lamplight" that helps you deepen your spiritual walk by generating personalized reflections and discovering meaningful connections between your notes.

We believe that your spiritual journal is sacred. Your devotional notes, sermon reflections, prayer entries, and personal meditations are deeply intimate expressions of your faith. We built LivePsalms with a foundational principle: **your notes are yours alone**. We do not read, review, access, monitor, or analyze your personal notes for any purpose other than storing them securely on your behalf and delivering them back to you when you request them. No employee, administrator, contractor, or automated system at LivePsalms will ever open, browse, or inspect the content of your notes. The only exception to this principle is when you explicitly opt into our Lamplight AI feature, in which case your note content is processed exclusively by automated systems to generate personalized devotional content — and even then, no human being ever sees your notes.

This Privacy Policy explains in detail how we collect, use, store, share, and protect your personal information, as well as your rights regarding your data under global regulations, including the General Data Protection Regulation (GDPR) [1], the California Consumer Privacy Act as amended by the California Privacy Rights Act (CCPA/CPRA) [2], the European Union Artificial Intelligence Act (EU AI Act) [3], and other applicable privacy laws worldwide.

---

## 1. Data Controller and Contact Information

LivePsalms is the data controller responsible for the processing of your personal data as described in this Privacy Policy. If you have any questions, concerns, or requests regarding your privacy, you may contact us at:

- **Email**: support@livepsalms.com
- **Mailing Address**: LivePsalms Privacy Team, 17130 Van Buren Blvd, Unit 855, Riverside, CA 92504, USA

If you are located in the European Economic Area (EEA) or the United Kingdom (UK) and wish to exercise your rights under applicable data protection laws, or if you have a complaint about how we handle your data, you may also contact your local Data Protection Authority (DPA).

---

## 2. Important Disclosures Regarding Sensitive Personal Data

Because LivePsalms is a faith-based platform, our processing of your notes, folder names, tags, and theological preferences inherently reveals information about your **religious beliefs**. Under the GDPR, religious beliefs are classified as "Special Category Data" under Article 9 [1]. Under the CCPA/CPRA, religious beliefs are classified as "Sensitive Personal Information" [2]. Under various other global privacy frameworks, similar heightened protections apply to data revealing religious convictions.

We recognize the profound sensitivity of this data and treat it with the highest level of care. We process your religious data solely on the basis of your **explicit consent**, which you provide by:

1. Creating an account and voluntarily entering devotional content into the platform.
2. Explicitly enabling the Lamplight AI feature through a dedicated toggle with a recorded consent timestamp.
3. Selecting theological preferences such as your tradition hint (evangelical, catholic, orthodox, or unspecified) and voice preference.

You may withdraw your consent at any time by deleting your notes, turning off the Lamplight AI feature, using the "Forget my Lamplight history" function, or permanently deleting your account. Withdrawal of consent does not affect the lawfulness of processing carried out prior to the withdrawal.

---

## 3. Information We Collect and How We Collect It

We collect several categories of information depending on how you interact with our platform. We adhere to the principle of **data minimization** — we only collect information that is strictly necessary to provide, maintain, and improve our services.

### 3.1 Personal Data Provided Directly by You

When you create an account, update your profile, or subscribe to our communications, you provide us with the following information:

| Category | Specific Fields | Purpose | Legal Basis (GDPR) | Required? |
| :--- | :--- | :--- | :--- | :--- |
| **Account Credentials** | Email address, password (stored only as a secure bcrypt hash — we never store your plaintext password) | To create, authenticate, and secure your account; to send transactional emails such as email verification and password reset links. | Performance of contract | Yes |
| **Profile Information** | Full name | To personalize your experience and address you by name within the application and in AI-generated devotional content. | Performance of contract | Yes |
| **Optional Profile Fields** | Date of birth, profile picture (avatar image) | To allow you to personalize your profile. Date of birth is never used for age-based targeting or shared with third parties. | Consent | No |
| **Newsletter Subscription** | Email address, source tag (indicating where you signed up) | To send you periodic updates, product announcements, and faith-based content. You may unsubscribe at any time. | Consent | No |

### 3.2 User-Generated Content

Your notes and organizational structures constitute the core of your LivePsalms experience. This content is stored securely on our servers to ensure cross-device access and data persistence.

| Category | Specific Fields | Purpose | Legal Basis (GDPR) |
| :--- | :--- | :--- | :--- |
| **Notes** | Title, rich-text content (stored as structured TipTap JSON), note type (devotion, sermon, or theme), user-defined tags, computed word count, creation and modification timestamps | To provide note-taking functionality, enable search, render your visual knowledge graph, and track your writing progress toward tier milestones. | Performance of contract / Explicit consent (religious content) |
| **Folders** | Folder name, hierarchical parent folder reference, display order, custom icon selection, custom color | To allow you to organize, categorize, and structure your notes in a way that reflects your personal study system. | Performance of contract |

> **Our Commitment**: We want to be unequivocally clear — **no one at LivePsalms will ever read, review, access, or inspect the content of your notes**. Your notes are encrypted in transit and stored in a database protected by Row Level Security (RLS), meaning that even at the database level, queries are restricted so that only your authenticated session can retrieve your own data. Our backend administrators do not have tooling or workflows that would allow them to browse individual user notes. Your spiritual reflections, prayers, and personal meditations remain entirely private.

### 3.3 Automatically Collected Technical Data

When you access LivePsalms, our infrastructure automatically processes limited technical information necessary to deliver the service securely.

| Category | Specific Fields | Purpose | Legal Basis (GDPR) |
| :--- | :--- | :--- | :--- |
| **Authentication Tokens** | JSON Web Tokens (JWTs), session identifiers | To maintain your authenticated session across page loads and API requests. | Performance of contract |
| **Application State** | Session-level flags stored in browser `sessionStorage` (e.g., whether the introductory animation has played) | To manage user interface transitions and prevent repetitive animations within a single browsing session. | Legitimate interest |

We do **not** use third-party analytics services, advertising trackers, behavioral profiling tools, or fingerprinting technologies. We do not embed social media tracking pixels. We do not serve advertisements of any kind.

### 3.4 Data Stored Locally on Your Device

If you use LivePsalms without creating an account or before logging in, your data is stored entirely on your device using your browser's `localStorage` mechanism. This data never leaves your device and is never transmitted to our servers unless you explicitly choose to create an account and migrate your local data to the cloud.

| Storage Key | Data Stored | Purpose |
| :--- | :--- | :--- |
| `notepad_notes` | Complete JSON array of all your notes (titles, content, tags, timestamps) | To provide offline-capable note-taking before account creation. |
| `notepad_folders` | Complete JSON array of all your folder structures | To provide offline-capable folder organization before account creation. |

Upon account creation, you are offered the opportunity to migrate this local data to your secure cloud account. After successful migration, the local copies are cleared from your browser. You may also clear this local data at any time by using your browser's built-in storage management tools.

---

## 4. The "Lamplight" AI Feature Suite — Detailed Disclosure

### 4.1 Overview and Opt-In Nature

Lamplight is our optional, AI-powered devotional assistant. It is designed to help you discover deeper spiritual connections in your notes by generating personalized daily devotions, identifying thematic relationships between your notes, and suggesting relevant Bible passages.

**Lamplight is entirely opt-in.** It is disabled by default for all users. To activate Lamplight, you must explicitly toggle the "Lamplight on" switch in your Profile settings. When you enable Lamplight, we record a `consent_decided_at` timestamp to document your explicit, informed consent. You may disable Lamplight at any time, which immediately halts all AI processing of your new notes.

### 4.2 What Data Lamplight Processes

When Lamplight is enabled, the following automated processes occur:

**Embedding Generation**: When you save or update a note, our system extracts the plaintext content of that note, splits it into manageable chunks, and sends those chunks to Voyage AI's embedding API to generate a mathematical vector representation (a 1024-dimensional numerical array). This vector captures the semantic meaning of your text without retaining the original words. The vector is stored in our database alongside a cryptographic hash of the content (used to avoid redundant reprocessing).

**Daily Devotion Generation**: When you request your "Today's Lamp" devotion, our system retrieves the plaintext of your 3 most recently updated notes (up to 800 characters each), your first name (derived from your profile), your voice preference, and your tradition hint. This context is sent to OpenAI's API, which generates a personalized devotional reflection grounded in your notes and relevant Bible passages.

**Connection Card Generation**: When our system identifies that two of your notes are semantically similar (based on their vector embeddings), it may generate a brief explanation of why those notes are connected. This involves sending the plaintext of both notes to OpenAI's API to produce a short, human-readable explanation.

### 4.3 What Data Lamplight Stores

| Data Category | What Is Stored | Retention Period | Can You Delete It? |
| :--- | :--- | :--- | :--- |
| **Settings** | Opt-in status, quiet mode, voice preference (Lord/Father/Abba/Jesus), tradition hint (evangelical/catholic/orthodox/unspecified), inline suggestions preference, weekly email preference, consent timestamp | Until you delete settings or your account | Yes — via "Forget my Lamplight history" |
| **Entitlements** | Your Lamplight tier (plus/lite/none), source (promo/subscription/grant), grant date, expiration date | Until your account is deleted | Yes — via account deletion |
| **Embeddings** | Source type (note or Bible passage), source ID, content hash, 1024-dimensional vector, metadata | Until you delete Lamplight history or your account | Yes — via "Forget my Lamplight history" |
| **Artifacts** | Generated devotion type, period key, title, body content, source note IDs, source Bible verses, AI model used, prompt version | Until you delete Lamplight history or your account | Yes — via "Forget my Lamplight history" |
| **Processing Jobs** | Job type, queue status, payload, attempt count, scheduling timestamps, error messages | Until you delete Lamplight history or your account | Yes — via "Forget my Lamplight history" |
| **Suggestions Log** | Note ID, Bible verse reference, explanation text, timestamp shown, user outcome (inserted/dismissed/ignored) | Until you delete Lamplight history or your account | Yes — via "Forget my Lamplight history" |
| **Connections** | Source note ID, related note ID, similarity score, explanation text, content hash | Until you delete Lamplight history or your account | Yes — via "Forget my Lamplight history" |
| **Usage Telemetry** | AI model name, artifact kind, input/output token counts, success/error status, error classification codes | Until your account is deleted | Yes — via account deletion |

### 4.4 Automated Decision-Making and Profiling

Lamplight uses automated processing to generate content recommendations and identify note connections. However, these automated processes do **not** produce any decisions that have legal or similarly significant effects on you. The AI-generated content is purely informational and devotional in nature. You are never denied access to any feature, charged differently, or treated differently based on the outputs of our AI systems.

Under GDPR Article 22, you have the right not to be subject to decisions based solely on automated processing that produce legal effects. Because our AI features do not produce such effects, Article 22 restrictions do not apply. Nevertheless, we provide full transparency about our automated processing and give you complete control to opt in, opt out, or delete all AI-generated data at any time.

### 4.5 AI-Generated Content Labeling

In compliance with the EU AI Act Article 50 [3], we clearly identify all AI-generated content within the LivePsalms interface. Daily devotions, connection card explanations, and verse suggestions generated by Lamplight are visually distinguished and labeled as AI-generated content so that you always know which content was written by you and which was produced by our AI systems.

---

## 5. How We Share Your Information — Sub-processors and Third Parties

### 5.1 Our No-Sale, No-Sharing Commitment

**We do not sell your personal information.** We do not share your personal information for cross-context behavioral advertising. We do not provide your data to data brokers, marketing networks, or any third party for their own independent use. We do not monetize your data in any way.

### 5.2 Sub-processors

To deliver our services, we engage a limited number of trusted technology partners who act as our data sub-processors. Each sub-processor is contractually bound to process your data only on our instructions and in accordance with applicable data protection laws.

| Sub-processor | Headquarters | Role | Data They Access | Training on Your Data? | Data Retention by Sub-processor |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Supabase, Inc.** | San Francisco, CA, USA | Cloud database hosting, user authentication (including OAuth flows), file storage for avatars, and serverless Edge Function execution. | All database records including profile data, notes, folders, and Lamplight tables. Hashed passwords. Avatar image files. | No | Data persists until you delete it or your account. Supabase does not independently retain copies beyond what is in the active database. |
| **OpenAI, L.L.C.** | San Francisco, CA, USA | Large Language Model provider (the GPT-5.6 model family). Used exclusively for generating devotional text, study and chat replies, and connection explanations within Lamplight. | Note plaintext (max 800 characters per note, max 3–5 notes per request), your first name, voice preference, and tradition hint. | **No.** Data sent to the OpenAI API is not used to train or improve OpenAI's models unless the customer explicitly opts in, which we have not [7]. | OpenAI may retain API inputs and outputs in abuse-monitoring logs for **up to 30 days**, after which they are deleted, unless a longer period is required by law [7]. |
| **Voyage AI Innovations, Inc.** | San Francisco, CA, USA | Text embedding generation and passage reranking. Used to convert note text into semantic vectors and to match Bible passages to your themes. | Plaintext note content (chunked) and search query text. | **No** (on paid tier). Voyage AI's terms state that paid-tier customer content is deleted immediately after processing when the customer has opted out of training [6]. | Content is deleted immediately after embedding generation is complete. |
| **Google LLC** | Mountain View, CA, USA | OAuth identity provider (Sign in with Google). | Your Google account email, display name, and profile picture — only when you choose to sign in with Google. | N/A | Governed by Google's own Privacy Policy. |
| **Apple Inc.** | Cupertino, CA, USA | OAuth identity provider (Sign in with Apple). | Your Apple ID email (or relay email if you choose to hide your email), and display name — only when you choose to sign in with Apple. | N/A | Governed by Apple's own Privacy Policy. |

### 5.3 No Human Access to Your Notes

We want to reiterate and expand upon our core commitment: **no LivePsalms employee or contractor will ever read, access, or review the content of your notes.** We have built no tool that would let us do so.

When your notes are processed by Lamplight, they are handled by automated machine learning systems. The AI models receive your text, generate a response, and the text passes through no human review pipeline of ours. Voyage AI's embedding service processes text mathematically without human inspection.

One limited exception applies at the model provider, and we state it plainly rather than promise more than we can deliver: under OpenAI's standard abuse-monitoring programme, API inputs and outputs are retained for up to 30 days and may be reviewed by an OpenAI reviewer if automated safety classifiers flag content as a potential violation of OpenAI's usage policies, or where review is required by law [7]. This content is not reviewed routinely, and it is never used to train models. Devotional notes are extremely unlikely to trigger such a classifier, but we will not claim an absolute guarantee that is not ours to give.

Our database is protected by Row Level Security (RLS) policies enforced at the PostgreSQL level. These policies ensure that database queries — even those executed by our own backend services — can only return data belonging to the authenticated user making the request. Our administrative tools do not include any interface for browsing, searching, or reading individual user notes.

---

## 6. Data Security

We implement multiple layers of security to protect your personal information:

**Encryption in Transit**: All data transmitted between your browser and our servers is encrypted using TLS 1.2 or higher (HTTPS). This includes your notes, authentication credentials, and all API communications with our sub-processors.

**Encryption at Rest**: Your data is stored on encrypted volumes within AWS data centers managed by Supabase. Database backups are also encrypted.

**Row Level Security (RLS)**: Every table in our database that contains user data is protected by PostgreSQL Row Level Security policies. These policies enforce that any query — whether from the application, an Edge Function, or an administrative tool — can only access rows belonging to the authenticated user. This is enforced at the database engine level, not merely at the application level, providing defense-in-depth.

**Authentication Security**: Passwords are hashed using industry-standard bcrypt algorithms before storage. We never store plaintext passwords. OAuth tokens from Google and Apple are handled by Supabase Auth and are never exposed to our application code.

**JWT Verification**: All serverless Edge Functions (which power Lamplight) require valid JSON Web Token authentication. Requests without valid tokens are rejected before any data processing occurs.

**Content Hashing for Deduplication**: Before sending note content to AI services, our system computes a SHA-256 hash of the content. If the hash matches a previously processed version, the note is not re-sent to external services, minimizing unnecessary data exposure.

**Service-Role Isolation**: Backend operations that require elevated database privileges (such as processing embedding jobs) use isolated service-role credentials that are never exposed to client-side code.

---

## 7. International Data Transfers

LivePsalms is hosted on cloud infrastructure provided by Supabase, utilizing Amazon Web Services (AWS) data centers. Our primary infrastructure is located in the **United States** [4] [8].

If you access our services from outside the United States — including from the European Economic Area (EEA), the United Kingdom (UK), Switzerland, or any other jurisdiction — your personal data will be transferred to and processed in the United States. We acknowledge that the United States may not provide the same level of data protection as your home jurisdiction.

To ensure that your data receives adequate protection during these international transfers, we implement the following safeguards:

1. **Standard Contractual Clauses (SCCs)**: We incorporate the European Commission's Standard Contractual Clauses into our agreements with sub-processors to provide appropriate safeguards for transfers of personal data from the EEA to the United States [4] [5].
2. **Data Processing Agreements (DPAs)**: We maintain formal Data Processing Agreements with all sub-processors that define their obligations regarding data security, confidentiality, and compliance with applicable data protection laws.
3. **Supplementary Measures**: We implement technical measures (encryption, access controls, pseudonymization where feasible) to supplement the contractual safeguards and address any residual risks associated with international transfers.

Our sub-processors' data processing locations are as follows:

| Sub-processor | Data Processing Location | Data Storage Location |
| :--- | :--- | :--- |
| Supabase | AWS region selected at project creation (US by default) | Same as processing region |
| OpenAI | United States (default processing region) | United States [5] |
| Voyage AI | United States | United States |

---

## 8. Data Retention and Deletion

We retain your personal information only for as long as necessary to fulfill the purposes for which it was collected, to comply with our legal obligations, or as permitted by applicable law. We do not retain data indefinitely without purpose.

| Data Category | Retention Period | Deletion Trigger |
| :--- | :--- | :--- |
| **Account profile** | Duration of your account | You delete your account from the Profile page. |
| **Notes and folders** | Duration of your account | You delete individual notes/folders, or delete your account (cascading deletion). |
| **Lamplight AI data** | Duration of your account or until you choose to delete it | You click "Forget my Lamplight history" or delete your account. |
| **Newsletter subscription** | Until you unsubscribe | You click the unsubscribe link in any newsletter email. |
| **Avatar image** | Duration of your account | You delete your account (best-effort cleanup from storage). |
| **Browser localStorage** | Until you clear it or migrate to cloud | You clear browser data, use browser storage tools, or migrate data upon account creation. |
| **Authentication session tokens** | Duration of your active session | You sign out or your session expires. |

**Cascading Deletion**: When you delete your account, our system executes a cascading deletion at the database level. Deleting your profile row automatically triggers the permanent deletion of all associated records: notes, folders, Lamplight settings, entitlements, embeddings, artifacts, jobs, suggestions logs, connections, and usage telemetry. This is enforced by foreign key constraints with `ON DELETE CASCADE` at the PostgreSQL level, ensuring no orphaned data remains.

**Backup Retention**: Database backups maintained by our infrastructure provider (Supabase) follow their standard retention schedule. Deleted data will be purged from backup systems within the backup rotation period (typically 7–30 days depending on the plan tier).

---

## 9. Your Privacy Rights and Controls

Depending on your location, you possess specific legal rights regarding your personal data. We have designed LivePsalms to make exercising these rights as simple and immediate as possible through built-in tools in your Profile settings.

### 9.1 Rights Under the GDPR (EEA/UK Residents)

If you are located in the European Economic Area or the United Kingdom, you have the following rights under the GDPR:

| Right | Description | How to Exercise in LivePsalms |
| :--- | :--- | :--- |
| **Right of Access** (Art. 15) | You have the right to obtain confirmation of whether we process your personal data and to receive a copy of that data. | Use the "Export Data" button on your Profile page to download a complete JSON file of all your notes and folders. For a full data subject access request, email support@livepsalms.com. |
| **Right to Rectification** (Art. 16) | You have the right to correct inaccurate personal data. | Edit your full name, date of birth, or avatar directly in your Profile settings. Edit note content at any time in the editor. |
| **Right to Erasure** (Art. 17) | You have the right to request deletion of your personal data ("right to be forgotten"). | Delete individual notes, use "Forget my Lamplight history" to erase all AI data, or use "Delete Account" for complete erasure. |
| **Right to Restriction** (Art. 18) | You have the right to restrict processing of your data in certain circumstances. | Turn off the "Lamplight on" toggle to immediately halt all AI processing while preserving your existing data. |
| **Right to Data Portability** (Art. 20) | You have the right to receive your data in a structured, commonly used, machine-readable format. | Use the "Export Data" button to download your notes and folders as structured JSON. |
| **Right to Object** (Art. 21) | You have the right to object to processing based on legitimate interests. | Contact support@livepsalms.com to object to any processing based on legitimate interests. |
| **Right to Withdraw Consent** (Art. 7) | You have the right to withdraw consent at any time without affecting the lawfulness of prior processing. | Disable Lamplight, delete your AI history, unsubscribe from newsletters, or delete your account. |
| **Right to Lodge a Complaint** | You have the right to lodge a complaint with your local Data Protection Authority. | Contact your local DPA. A list of EU DPAs is available at [edpb.europa.eu](https://edpb.europa.eu/about-edpb/about-edpb/members_en). |

### 9.2 Rights Under the CCPA/CPRA (California Residents)

If you are a California resident, you have the following rights under the California Consumer Privacy Act as amended by the California Privacy Rights Act:

| Right | Description | How to Exercise |
| :--- | :--- | :--- |
| **Right to Know** | You have the right to know what personal information we collect, use, disclose, and sell. | This Privacy Policy provides comprehensive disclosure. For a personalized report, email support@livepsalms.com. |
| **Right to Delete** | You have the right to request deletion of your personal information. | Use "Delete Account" in your Profile, or email support@livepsalms.com. |
| **Right to Correct** | You have the right to correct inaccurate personal information. | Edit your profile directly, or email support@livepsalms.com. |
| **Right to Opt-Out of Sale/Sharing** | You have the right to opt out of the sale or sharing of your personal information. | **We do not sell or share your personal information.** No opt-out is necessary. |
| **Right to Limit Use of Sensitive PI** | You have the right to limit the use and disclosure of your sensitive personal information. | Disable Lamplight to stop AI processing of your religious content. Delete your account to remove all data. |
| **Right to Non-Discrimination** | You have the right not to be discriminated against for exercising your privacy rights. | We will never deny you service, charge different prices, or provide different quality based on your exercise of privacy rights. |

We will respond to verifiable consumer requests within 45 days. If we need additional time (up to 45 more days), we will notify you of the extension and the reason.

### 9.3 Do Not Track / Global Privacy Control

LivePsalms does not track users across third-party websites and does not serve targeted advertising. We honor Global Privacy Control (GPC) signals. Because we do not sell or share personal information for advertising purposes, GPC signals do not change the functionality of our service, but we respect them as a valid expression of your privacy preferences.

---

## 10. Cookies and Tracking Technologies

We use a minimal set of browser storage technologies strictly necessary to provide our service. We do **not** use:

- Third-party analytics cookies (no Google Analytics, no Mixpanel, no Amplitude)
- Advertising or retargeting cookies
- Social media tracking pixels
- Browser fingerprinting technologies
- Cross-site tracking mechanisms

The only browser storage we use is:

| Technology | Type | Purpose | Duration | Contains Personal Data? |
| :--- | :--- | :--- | :--- | :--- |
| **Supabase Auth Token** | `localStorage` | Maintains your authenticated session so you don't have to log in on every page load. | Until you sign out or the token expires. | Yes (contains encrypted session identifier) |
| **Notepad Data (pre-login)** | `localStorage` | Stores your notes and folders locally when you use the app without an account. | Until you clear it or migrate to cloud. | Yes (contains your note content) |
| **Intro Animation Flag** | `sessionStorage` | Remembers that the home page intro animation has already played during this browser tab session. | Until you close the browser tab. | No |

Because we do not use non-essential cookies, we do not display a cookie consent banner. All storage mechanisms we use are strictly necessary for the functioning of the service.

---

## 11. Children's Privacy

LivePsalms is not directed at, marketed to, or intended for use by children under the age of 13 (or under the age of 16 in jurisdictions where the GDPR applies and the member state has not lowered the digital age of consent). We do not knowingly collect, solicit, or process personal information from children below these age thresholds.

If we become aware that we have inadvertently collected personal data from a child without verifiable parental consent, we will take immediate steps to delete that information from our systems. If you are a parent or guardian and believe that your child has provided us with personal data without your consent, please contact us immediately at support@livepsalms.com, and we will promptly investigate and remove the data.

We do not use age verification mechanisms at registration. The optional "date of birth" field in the user profile is not used for age-gating purposes and is entirely voluntary.

---

## 12. Third-Party Links and Services

LivePsalms may contain links to third-party websites, services, or resources that are not operated by us. If you click on a third-party link, you will be directed to that third party's site. We strongly advise you to review the privacy policy of every site you visit.

We have no control over and assume no responsibility for the content, privacy policies, or practices of any third-party sites or services. Our inclusion of links to third-party resources does not imply endorsement of their privacy practices.

---

## 13. Changes to This Privacy Policy

We may update this Privacy Policy from time to time to reflect changes in our data practices, the addition of new features, changes in applicable law, or updates to our sub-processor relationships. When we make changes:

1. We will update the "Last Updated" date at the top of this document.
2. For **material changes** — such as new categories of data collection, new sub-processors, or changes to how we use AI — we will provide prominent notice through one or more of the following methods:
   - A banner notification within the LivePsalms application.
   - An email notification sent to the address associated with your account.
   - A prominent announcement on our website.
3. Where required by law, we will obtain your renewed consent before implementing changes that affect the processing of your sensitive personal data.

We encourage you to review this Privacy Policy periodically. Your continued use of LivePsalms after the effective date of any changes constitutes your acceptance of the updated policy, except where additional consent is required by law.

---

## 14. Legal Bases for Processing (GDPR)

For users in the EEA and UK, we process your personal data on the following legal bases:

| Processing Activity | Legal Basis | Justification |
| :--- | :--- | :--- |
| Account creation and authentication | Performance of contract (Art. 6(1)(b)) | Necessary to provide you with the LivePsalms service you signed up for. |
| Storing and syncing your notes and folders | Performance of contract (Art. 6(1)(b)) | Core functionality of the service you contracted for. |
| Processing religious content in notes | Explicit consent (Art. 9(2)(a)) | You explicitly consent by entering devotional content into a platform you know is designed for religious note-taking. |
| Lamplight AI processing | Explicit consent (Art. 9(2)(a) + Art. 6(1)(a)) | You explicitly opt in via the Lamplight toggle, with a recorded consent timestamp. |
| Sending newsletter emails | Consent (Art. 6(1)(a)) | You voluntarily subscribe and can unsubscribe at any time. |
| Maintaining session security | Legitimate interest (Art. 6(1)(f)) | Necessary to prevent unauthorized access and protect your account. |
| System performance monitoring | Legitimate interest (Art. 6(1)(f)) | Necessary to maintain service reliability and detect/prevent abuse. |

---

## 15. California-Specific Disclosures

In the preceding 12 months, we have collected the following categories of personal information as defined by the CCPA:

| CCPA Category | Examples from LivePsalms | Sold? | Shared for Advertising? |
| :--- | :--- | :--- | :--- |
| Identifiers | Email address, full name, user ID | No | No |
| Personal information under Cal. Civ. Code § 1798.80 | Name, email address | No | No |
| Internet or network activity | Session tokens, authentication logs | No | No |
| Sensitive personal information (religious beliefs) | Note content revealing religious beliefs, tradition preferences | No | No |
| Inferences drawn from personal information | AI-generated embeddings, connection scores, devotional content | No | No |

**We do not sell personal information. We do not share personal information for cross-context behavioral advertising. We have not done so in the preceding 12 months, and we have no plans to do so in the future.**

---

## 16. Security Incident Response

In the unlikely event of a data breach that affects your personal information, we will:

1. Notify affected users without undue delay and, where feasible, within 72 hours of becoming aware of the breach (as required by GDPR Article 33).
2. Notify the relevant Data Protection Authority where required by law.
3. Provide you with information about the nature of the breach, the categories of data affected, the likely consequences, and the measures we have taken or propose to take to address the breach.
4. Offer guidance on steps you can take to protect yourself.

---

## 17. Contact Us

If you have any questions, concerns, requests, or complaints about this Privacy Policy, our data practices, or your privacy rights, please contact us:

- **Email**: support@livepsalms.com
- **Mailing Address**: LivePsalms Privacy Team, 17130 Van Buren Blvd, Unit 855, Riverside, CA 92504, USA
- **Response Time**: We aim to respond to all privacy-related inquiries within 30 days (or 45 days for formal CCPA requests).

For EEA/UK residents, if you are unsatisfied with our response, you have the right to lodge a complaint with your local Data Protection Authority.

---

## References

- [1] [EU General Data Protection Regulation (GDPR) — Full Text](https://gdpr-info.eu/)
- [2] [California Consumer Privacy Act (CCPA/CPRA) — California Attorney General](https://oag.ca.gov/privacy/ccpa)
- [3] [EU Artificial Intelligence Act — Article 50: Transparency Obligations](https://artificialintelligenceact.eu/article/50/)
- [4] [Supabase Data Processing Addendum (DPA)](https://supabase.com/legal/dpa)
- [5] [OpenAI Platform — Data Residency and Processing Regions](https://developers.openai.com/api/docs/guides/your-data)
- [6] [Voyage AI Terms of Service — Section 3: Content and Models](https://www.voyageai.com/tos)
- [7] [OpenAI Platform — Data Controls: Training, Retention, and Abuse Monitoring](https://developers.openai.com/api/docs/guides/your-data)
- [8] [Supabase Platform Regions Documentation](https://supabase.com/docs/guides/platform/regions)
- [9] [Privacy Laws 2026: Global Changes, Enforcement & Compliance Guide](https://secureprivacy.ai/blog/privacy-laws-2026)
- [10] [EU AI Act — Regulatory Framework Overview](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)
