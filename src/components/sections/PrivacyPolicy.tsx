import { LegalPage } from './LegalPage';

export function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy" effectiveDate="May 28, 2026" lastUpdated="May 28, 2026">
      <h2>Our Privacy Commitment</h2>
      <p>
        Welcome to LivePsalms. We provide a faith-based, interconnected note-taking platform
        designed for Christian devotional practices, sermon listening, and thematic Bible study. Our
        services include an optional AI-powered feature suite called "Lamplight" that helps you
        deepen your spiritual walk by generating personalized reflections and discovering meaningful
        connections between your notes.
      </p>
      <p>
        We believe that your spiritual journal is sacred. Your devotional notes, sermon reflections,
        prayer entries, and personal meditations are deeply intimate expressions of your faith. We
        built LivePsalms with a foundational principle: <strong>your notes are yours alone</strong>.
        We do not read, review, access, monitor, or analyze your personal notes for any purpose
        other than storing them securely on your behalf and delivering them back to you when you
        request them. No employee, administrator, contractor, or automated system at LivePsalms will
        ever open, browse, or inspect the content of your notes. The only exception to this
        principle is when you explicitly opt into our Lamplight AI feature, in which case your note
        content is processed exclusively by automated systems to generate personalized devotional
        content — and even then, no human being ever sees your notes.
      </p>
      <p>
        This Privacy Policy explains in detail how we collect, use, store, share, and protect your
        personal information, as well as your rights regarding your data under global regulations,
        including the General Data Protection Regulation (GDPR) [1], the California Consumer
        Privacy Act as amended by the California Privacy Rights Act (CCPA/CPRA) [2], the European
        Union Artificial Intelligence Act (EU AI Act) [3], and other applicable privacy laws
        worldwide.
      </p>

      <hr />

      <h2>1. Data Controller and Contact Information</h2>
      <p>
        LivePsalms is the data controller responsible for the processing of your personal data as
        described in this Privacy Policy. If you have any questions, concerns, or requests regarding
        your privacy, you may contact us at:
      </p>
      <ul>
        <li>
          <strong>Email</strong>:{' '}
          <a href="mailto:support@livepsalms.com">support@livepsalms.com</a>
        </li>
        <li>
          <strong>Mailing Address</strong>: LivePsalms Privacy Team, 17130 Van Buren Blvd, Unit
          855, Riverside, CA 92504, USA
        </li>
      </ul>
      <p>
        If you are located in the European Economic Area (EEA) or the United Kingdom (UK) and wish
        to exercise your rights under applicable data protection laws, or if you have a complaint
        about how we handle your data, you may also contact your local Data Protection Authority
        (DPA).
      </p>

      <hr />

      <h2>2. Important Disclosures Regarding Sensitive Personal Data</h2>
      <p>
        Because LivePsalms is a faith-based platform, our processing of your notes, folder names,
        tags, and theological preferences inherently reveals information about your{' '}
        <strong>religious beliefs</strong>. Under the GDPR, religious beliefs are classified as
        "Special Category Data" under Article 9 [1]. Under the CCPA/CPRA, religious beliefs are
        classified as "Sensitive Personal Information" [2]. Under various other global privacy
        frameworks, similar heightened protections apply to data revealing religious convictions.
      </p>
      <p>
        We recognize the profound sensitivity of this data and treat it with the highest level of
        care. We process your religious data solely on the basis of your{' '}
        <strong>explicit consent</strong>, which you provide by:
      </p>
      <ol>
        <li>
          Creating an account and voluntarily entering devotional content into the platform.
        </li>
        <li>
          Explicitly enabling the Lamplight AI feature through a dedicated toggle with a recorded
          consent timestamp.
        </li>
        <li>
          Selecting theological preferences such as your tradition hint (evangelical, catholic,
          orthodox, or unspecified) and voice preference.
        </li>
      </ol>
      <p>
        You may withdraw your consent at any time by deleting your notes, turning off the Lamplight
        AI feature, using the "Forget my Lamplight history" function, or permanently deleting your
        account. Withdrawal of consent does not affect the lawfulness of processing carried out
        prior to the withdrawal.
      </p>

      <hr />

      <h2>3. Information We Collect and How We Collect It</h2>
      <p>
        We collect several categories of information depending on how you interact with our
        platform. We adhere to the principle of <strong>data minimization</strong> — we only
        collect information that is strictly necessary to provide, maintain, and improve our
        services.
      </p>

      <h3>3.1 Personal Data Provided Directly by You</h3>
      <p>
        When you create an account, update your profile, or subscribe to our communications, you
        provide us with the following information:
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Specific Fields</th>
              <th>Purpose</th>
              <th>Legal Basis (GDPR)</th>
              <th>Required?</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Account Credentials</strong>
              </td>
              <td>
                Email address, password (stored only as a secure bcrypt hash — we never store your
                plaintext password)
              </td>
              <td>
                To create, authenticate, and secure your account; to send transactional emails such
                as email verification and password reset links.
              </td>
              <td>Performance of contract</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>
                <strong>Profile Information</strong>
              </td>
              <td>Full name</td>
              <td>
                To personalize your experience and address you by name within the application and in
                AI-generated devotional content.
              </td>
              <td>Performance of contract</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>
                <strong>Optional Profile Fields</strong>
              </td>
              <td>Date of birth, profile picture (avatar image)</td>
              <td>
                To allow you to personalize your profile. Date of birth is never used for age-based
                targeting or shared with third parties.
              </td>
              <td>Consent</td>
              <td>No</td>
            </tr>
            <tr>
              <td>
                <strong>Newsletter Subscription</strong>
              </td>
              <td>Email address, source tag (indicating where you signed up)</td>
              <td>
                To send you periodic updates, product announcements, and faith-based content. You
                may unsubscribe at any time.
              </td>
              <td>Consent</td>
              <td>No</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>3.2 User-Generated Content</h3>
      <p>
        Your notes and organizational structures constitute the core of your LivePsalms experience.
        This content is stored securely on our servers to ensure cross-device access and data
        persistence.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Specific Fields</th>
              <th>Purpose</th>
              <th>Legal Basis (GDPR)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Notes</strong>
              </td>
              <td>
                Title, rich-text content (stored as structured TipTap JSON), note type (devotion,
                sermon, or theme), user-defined tags, computed word count, creation and modification
                timestamps
              </td>
              <td>
                To provide note-taking functionality, enable search, render your visual knowledge
                graph, and track your writing progress toward tier milestones.
              </td>
              <td>Performance of contract / Explicit consent (religious content)</td>
            </tr>
            <tr>
              <td>
                <strong>Folders</strong>
              </td>
              <td>
                Folder name, hierarchical parent folder reference, display order, custom icon
                selection, custom color
              </td>
              <td>
                To allow you to organize, categorize, and structure your notes in a way that
                reflects your personal study system.
              </td>
              <td>Performance of contract</td>
            </tr>
          </tbody>
        </table>
      </div>
      <blockquote>
        <p>
          <strong>Our Commitment</strong>: We want to be unequivocally clear —{' '}
          <strong>
            no one at LivePsalms will ever read, review, access, or inspect the content of your
            notes
          </strong>
          . Your notes are encrypted in transit and stored in a database protected by Row Level
          Security (RLS), meaning that even at the database level, queries are restricted so that
          only your authenticated session can retrieve your own data. Our backend administrators do
          not have tooling or workflows that would allow them to browse individual user notes. Your
          spiritual reflections, prayers, and personal meditations remain entirely private.
        </p>
      </blockquote>

      <h3>3.3 Automatically Collected Technical Data</h3>
      <p>
        When you access LivePsalms, our infrastructure automatically processes limited technical
        information necessary to deliver the service securely.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Specific Fields</th>
              <th>Purpose</th>
              <th>Legal Basis (GDPR)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Authentication Tokens</strong>
              </td>
              <td>JSON Web Tokens (JWTs), session identifiers</td>
              <td>
                To maintain your authenticated session across page loads and API requests.
              </td>
              <td>Performance of contract</td>
            </tr>
            <tr>
              <td>
                <strong>Application State</strong>
              </td>
              <td>
                Session-level flags stored in browser sessionStorage (e.g., whether the introductory
                animation has played)
              </td>
              <td>
                To manage user interface transitions and prevent repetitive animations within a
                single browsing session.
              </td>
              <td>Legitimate interest</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        We do <strong>not</strong> use third-party analytics services, advertising trackers,
        behavioral profiling tools, or fingerprinting technologies. We do not embed social media
        tracking pixels. We do not serve advertisements of any kind.
      </p>

      <h3>3.4 Data Stored Locally on Your Device</h3>
      <p>
        If you use LivePsalms without creating an account or before logging in, your data is stored
        entirely on your device using your browser's localStorage mechanism. This data never leaves
        your device and is never transmitted to our servers unless you explicitly choose to create
        an account and migrate your local data to the cloud.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Storage Key</th>
              <th>Data Stored</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>notepad_notes</code></td>
              <td>
                Complete JSON array of all your notes (titles, content, tags, timestamps)
              </td>
              <td>To provide offline-capable note-taking before account creation.</td>
            </tr>
            <tr>
              <td><code>notepad_folders</code></td>
              <td>Complete JSON array of all your folder structures</td>
              <td>To provide offline-capable folder organization before account creation.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Upon account creation, you are offered the opportunity to migrate this local data to your
        secure cloud account. After successful migration, the local copies are cleared from your
        browser. You may also clear this local data at any time by using your browser's built-in
        storage management tools.
      </p>

      <hr />

      <h2>4. The "Lamplight" AI Feature Suite — Detailed Disclosure</h2>

      <h3>4.1 Overview and Opt-In Nature</h3>
      <p>
        Lamplight is our optional, AI-powered devotional assistant. It is designed to help you
        discover deeper spiritual connections in your notes by generating personalized daily
        devotions, identifying thematic relationships between your notes, and suggesting relevant
        Bible passages.
      </p>
      <p>
        <strong>Lamplight is entirely opt-in.</strong> It is disabled by default for all users. To
        activate Lamplight, you must explicitly toggle the "Lamplight on" switch in your Profile
        settings. When you enable Lamplight, we record a <code>consent_decided_at</code> timestamp
        to document your explicit, informed consent. You may disable Lamplight at any time, which
        immediately halts all AI processing of your new notes.
      </p>

      <h3>4.2 What Data Lamplight Processes</h3>
      <p>When Lamplight is enabled, the following automated processes occur:</p>
      <p>
        <strong>Embedding Generation</strong>: When you save or update a note, our system extracts
        the plaintext content of that note, splits it into manageable chunks, and sends those chunks
        to Voyage AI's embedding API to generate a mathematical vector representation (a
        1024-dimensional numerical array). This vector captures the semantic meaning of your text
        without retaining the original words. The vector is stored in our database alongside a
        cryptographic hash of the content (used to avoid redundant reprocessing).
      </p>
      <p>
        <strong>Daily Devotion Generation</strong>: When you request your "Today's Lamp" devotion,
        our system retrieves the plaintext of your 3 most recently updated notes (up to 800
        characters each), your first name (derived from your profile), your voice preference, and
        your tradition hint. This context is sent to OpenAI's API, which generates a
        personalized devotional reflection grounded in your notes and relevant Bible passages.
      </p>
      <p>
        <strong>Connection Card Generation</strong>: When our system identifies that two of your
        notes are semantically similar (based on their vector embeddings), it may generate a brief
        explanation of why those notes are connected. This involves sending the plaintext of both
        notes to OpenAI's API to produce a short, human-readable explanation.
      </p>

      <h3>4.3 What Data Lamplight Stores</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data Category</th>
              <th>What Is Stored</th>
              <th>Retention Period</th>
              <th>Can You Delete It?</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Settings</strong>
              </td>
              <td>
                Opt-in status, quiet mode, voice preference (Lord/Father/Abba/Jesus), tradition
                hint (evangelical/catholic/orthodox/unspecified), inline suggestions preference,
                weekly email preference, consent timestamp
              </td>
              <td>Until you delete settings or your account</td>
              <td>Yes — via "Forget my Lamplight history"</td>
            </tr>
            <tr>
              <td>
                <strong>Entitlements</strong>
              </td>
              <td>
                Your Lamplight tier (plus/lite/none), source (promo/subscription/grant), grant
                date, expiration date
              </td>
              <td>Until your account is deleted</td>
              <td>Yes — via account deletion</td>
            </tr>
            <tr>
              <td>
                <strong>Embeddings</strong>
              </td>
              <td>
                Source type (note or Bible passage), source ID, content hash, 1024-dimensional
                vector, metadata
              </td>
              <td>Until you delete Lamplight history or your account</td>
              <td>Yes — via "Forget my Lamplight history"</td>
            </tr>
            <tr>
              <td>
                <strong>Artifacts</strong>
              </td>
              <td>
                Generated devotion type, period key, title, body content, source note IDs, source
                Bible verses, AI model used, prompt version
              </td>
              <td>Until you delete Lamplight history or your account</td>
              <td>Yes — via "Forget my Lamplight history"</td>
            </tr>
            <tr>
              <td>
                <strong>Processing Jobs</strong>
              </td>
              <td>
                Job type, queue status, payload, attempt count, scheduling timestamps, error
                messages
              </td>
              <td>Until you delete Lamplight history or your account</td>
              <td>Yes — via "Forget my Lamplight history"</td>
            </tr>
            <tr>
              <td>
                <strong>Suggestions Log</strong>
              </td>
              <td>
                Note ID, Bible verse reference, explanation text, timestamp shown, user outcome
                (inserted/dismissed/ignored)
              </td>
              <td>Until you delete Lamplight history or your account</td>
              <td>Yes — via "Forget my Lamplight history"</td>
            </tr>
            <tr>
              <td>
                <strong>Connections</strong>
              </td>
              <td>
                Source note ID, related note ID, similarity score, explanation text, content hash
              </td>
              <td>Until you delete Lamplight history or your account</td>
              <td>Yes — via "Forget my Lamplight history"</td>
            </tr>
            <tr>
              <td>
                <strong>Usage Telemetry</strong>
              </td>
              <td>
                AI model name, artifact kind, input/output token counts, success/error status,
                error classification codes
              </td>
              <td>Until your account is deleted</td>
              <td>Yes — via account deletion</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>4.4 Automated Decision-Making and Profiling</h3>
      <p>
        Lamplight uses automated processing to generate content recommendations and identify note
        connections. However, these automated processes do <strong>not</strong> produce any
        decisions that have legal or similarly significant effects on you. The AI-generated content
        is purely informational and devotional in nature. You are never denied access to any
        feature, charged differently, or treated differently based on the outputs of our AI systems.
      </p>
      <p>
        Under GDPR Article 22, you have the right not to be subject to decisions based solely on
        automated processing that produce legal effects. Because our AI features do not produce such
        effects, Article 22 restrictions do not apply. Nevertheless, we provide full transparency
        about our automated processing and give you complete control to opt in, opt out, or delete
        all AI-generated data at any time.
      </p>

      <h3>4.5 AI-Generated Content Labeling</h3>
      <p>
        In compliance with the EU AI Act Article 50 [3], we clearly identify all AI-generated
        content within the LivePsalms interface. Daily devotions, connection card explanations, and
        verse suggestions generated by Lamplight are visually distinguished and labeled as
        AI-generated content so that you always know which content was written by you and which was
        produced by our AI systems.
      </p>

      <hr />

      <h2>5. How We Share Your Information — Sub-processors and Third Parties</h2>

      <h3>5.1 Our No-Sale, No-Sharing Commitment</h3>
      <p>
        <strong>We do not sell your personal information.</strong> We do not share your personal
        information for cross-context behavioral advertising. We do not provide your data to data
        brokers, marketing networks, or any third party for their own independent use. We do not
        monetize your data in any way.
      </p>

      <h3>5.2 Sub-processors</h3>
      <p>
        To deliver our services, we engage a limited number of trusted technology partners who act
        as our data sub-processors. Each sub-processor is contractually bound to process your data
        only on our instructions and in accordance with applicable data protection laws.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sub-processor</th>
              <th>Headquarters</th>
              <th>Role</th>
              <th>Data They Access</th>
              <th>Training on Your Data?</th>
              <th>Data Retention by Sub-processor</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Supabase, Inc.</strong>
              </td>
              <td>San Francisco, CA, USA</td>
              <td>
                Cloud database hosting, user authentication (including OAuth flows), file storage
                for avatars, and serverless Edge Function execution.
              </td>
              <td>
                All database records including profile data, notes, folders, and Lamplight tables.
                Hashed passwords. Avatar image files.
              </td>
              <td>No</td>
              <td>
                Data persists until you delete it or your account. Supabase does not independently
                retain copies beyond what is in the active database.
              </td>
            </tr>
            <tr>
              <td>
                <strong>OpenAI, L.L.C.</strong>
              </td>
              <td>San Francisco, CA, USA</td>
              <td>
                Large Language Model provider (the GPT-5.6 model family). Used exclusively for
                generating devotional text, study and chat replies, and connection explanations
                within Lamplight.
              </td>
              <td>
                Note plaintext (max 800 characters per note, max 3–5 notes per request), your
                first name, voice preference, and tradition hint.
              </td>
              <td>
                <strong>No.</strong> Data sent to the OpenAI API is not used to train or improve
                OpenAI's models unless the customer explicitly opts in, which we have not [7].
              </td>
              <td>
                OpenAI may retain API inputs and outputs in abuse-monitoring logs for{' '}
                <strong>up to 30 days</strong>, after which they are deleted, unless a longer
                period is required by law [7].
              </td>
            </tr>
            <tr>
              <td>
                <strong>Voyage AI Innovations, Inc.</strong>
              </td>
              <td>San Francisco, CA, USA</td>
              <td>
                Text embedding generation and passage reranking. Used to convert note text into
                semantic vectors and to match Bible passages to your themes.
              </td>
              <td>Plaintext note content (chunked) and search query text.</td>
              <td>
                <strong>No</strong> (on paid tier). Voyage AI's terms state that paid-tier customer
                content is deleted immediately after processing when the customer has opted out of
                training [6].
              </td>
              <td>
                Content is deleted immediately after embedding generation is complete.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Google LLC</strong>
              </td>
              <td>Mountain View, CA, USA</td>
              <td>OAuth identity provider (Sign in with Google).</td>
              <td>
                Your Google account email, display name, and profile picture — only when you choose
                to sign in with Google.
              </td>
              <td>N/A</td>
              <td>Governed by Google's own Privacy Policy.</td>
            </tr>
            <tr>
              <td>
                <strong>Apple Inc.</strong>
              </td>
              <td>Cupertino, CA, USA</td>
              <td>OAuth identity provider (Sign in with Apple).</td>
              <td>
                Your Apple ID email (or relay email if you choose to hide your email), and display
                name — only when you choose to sign in with Apple.
              </td>
              <td>N/A</td>
              <td>Governed by Apple's own Privacy Policy.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>5.3 No Human Access to Your Notes</h3>
      <p>
        We want to reiterate and expand upon our core commitment:{' '}
        <strong>
          no LivePsalms employee or contractor will ever read, access, or review the content of
          your notes.
        </strong>{' '}
        We have built no tool that would let us do so.
      </p>
      <p>
        When your notes are processed by Lamplight, they are handled by automated machine learning
        systems. The AI models receive your text, generate a response, and the text passes through
        no human review pipeline of ours. Voyage AI's embedding service processes text
        mathematically without human inspection.
      </p>
      <p>
        One limited exception applies at the model provider, and we state it plainly rather than
        promise more than we can deliver: under OpenAI's standard abuse-monitoring programme, API
        inputs and outputs are retained for up to 30 days and may be reviewed by an OpenAI reviewer
        if automated safety classifiers flag content as a potential violation of OpenAI's usage
        policies, or where review is required by law [7]. This content is not reviewed routinely,
        and it is never used to train models. Devotional notes are extremely unlikely to trigger
        such a classifier, but we will not claim an absolute guarantee that is not ours to give.
      </p>
      <p>
        Our database is protected by Row Level Security (RLS) policies enforced at the PostgreSQL
        level. These policies ensure that database queries — even those executed by our own backend
        services — can only return data belonging to the authenticated user making the request. Our
        administrative tools do not include any interface for browsing, searching, or reading
        individual user notes.
      </p>

      <hr />

      <h2>6. Data Security</h2>
      <p>
        We implement multiple layers of security to protect your personal information:
      </p>
      <p>
        <strong>Encryption in Transit</strong>: All data transmitted between your browser and our
        servers is encrypted using TLS 1.2 or higher (HTTPS). This includes your notes,
        authentication credentials, and all API communications with our sub-processors.
      </p>
      <p>
        <strong>Encryption at Rest</strong>: Your data is stored on encrypted volumes within AWS
        data centers managed by Supabase. Database backups are also encrypted.
      </p>
      <p>
        <strong>Row Level Security (RLS)</strong>: Every table in our database that contains user
        data is protected by PostgreSQL Row Level Security policies. These policies enforce that any
        query — whether from the application, an Edge Function, or an administrative tool — can
        only access rows belonging to the authenticated user. This is enforced at the database
        engine level, not merely at the application level, providing defense-in-depth.
      </p>
      <p>
        <strong>Authentication Security</strong>: Passwords are hashed using industry-standard
        bcrypt algorithms before storage. We never store plaintext passwords. OAuth tokens from
        Google and Apple are handled by Supabase Auth and are never exposed to our application code.
      </p>
      <p>
        <strong>JWT Verification</strong>: All serverless Edge Functions (which power Lamplight)
        require valid JSON Web Token authentication. Requests without valid tokens are rejected
        before any data processing occurs.
      </p>
      <p>
        <strong>Content Hashing for Deduplication</strong>: Before sending note content to AI
        services, our system computes a SHA-256 hash of the content. If the hash matches a
        previously processed version, the note is not re-sent to external services, minimizing
        unnecessary data exposure.
      </p>
      <p>
        <strong>Service-Role Isolation</strong>: Backend operations that require elevated database
        privileges (such as processing embedding jobs) use isolated service-role credentials that
        are never exposed to client-side code.
      </p>

      <hr />

      <h2>7. International Data Transfers</h2>
      <p>
        LivePsalms is hosted on cloud infrastructure provided by Supabase, utilizing Amazon Web
        Services (AWS) data centers. Our primary infrastructure is located in the{' '}
        <strong>United States</strong> [4] [8].
      </p>
      <p>
        If you access our services from outside the United States — including from the European
        Economic Area (EEA), the United Kingdom (UK), Switzerland, or any other jurisdiction —
        your personal data will be transferred to and processed in the United States. We acknowledge
        that the United States may not provide the same level of data protection as your home
        jurisdiction.
      </p>
      <p>
        To ensure that your data receives adequate protection during these international transfers,
        we implement the following safeguards:
      </p>
      <ol>
        <li>
          <strong>Standard Contractual Clauses (SCCs)</strong>: We incorporate the European
          Commission's Standard Contractual Clauses into our agreements with sub-processors to
          provide appropriate safeguards for transfers of personal data from the EEA to the United
          States [4] [5].
        </li>
        <li>
          <strong>Data Processing Agreements (DPAs)</strong>: We maintain formal Data Processing
          Agreements with all sub-processors that define their obligations regarding data security,
          confidentiality, and compliance with applicable data protection laws.
        </li>
        <li>
          <strong>Supplementary Measures</strong>: We implement technical measures (encryption,
          access controls, pseudonymization where feasible) to supplement the contractual safeguards
          and address any residual risks associated with international transfers.
        </li>
      </ol>
      <p>Our sub-processors' data processing locations are as follows:</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sub-processor</th>
              <th>Data Processing Location</th>
              <th>Data Storage Location</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Supabase</td>
              <td>AWS region selected at project creation (US by default)</td>
              <td>Same as processing region</td>
            </tr>
            <tr>
              <td>OpenAI</td>
              <td>United States (default processing region)</td>
              <td>United States [5]</td>
            </tr>
            <tr>
              <td>Voyage AI</td>
              <td>United States</td>
              <td>United States</td>
            </tr>
          </tbody>
        </table>
      </div>

      <hr />

      <h2>8. Data Retention and Deletion</h2>
      <p>
        We retain your personal information only for as long as necessary to fulfill the purposes
        for which it was collected, to comply with our legal obligations, or as permitted by
        applicable law. We do not retain data indefinitely without purpose.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data Category</th>
              <th>Retention Period</th>
              <th>Deletion Trigger</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Account profile</strong>
              </td>
              <td>Duration of your account</td>
              <td>You delete your account from the Profile page.</td>
            </tr>
            <tr>
              <td>
                <strong>Notes and folders</strong>
              </td>
              <td>Duration of your account</td>
              <td>
                You delete individual notes/folders, or delete your account (cascading deletion).
              </td>
            </tr>
            <tr>
              <td>
                <strong>Lamplight AI data</strong>
              </td>
              <td>Duration of your account or until you choose to delete it</td>
              <td>
                You click "Forget my Lamplight history" or delete your account.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Newsletter subscription</strong>
              </td>
              <td>Until you unsubscribe</td>
              <td>You click the unsubscribe link in any newsletter email.</td>
            </tr>
            <tr>
              <td>
                <strong>Avatar image</strong>
              </td>
              <td>Duration of your account</td>
              <td>You delete your account (best-effort cleanup from storage).</td>
            </tr>
            <tr>
              <td>
                <strong>Browser localStorage</strong>
              </td>
              <td>Until you clear it or migrate to cloud</td>
              <td>
                You clear browser data, use browser storage tools, or migrate data upon account
                creation.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Authentication session tokens</strong>
              </td>
              <td>Duration of your active session</td>
              <td>You sign out or your session expires.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        <strong>Cascading Deletion</strong>: When you delete your account, our system executes a
        cascading deletion at the database level. Deleting your profile row automatically triggers
        the permanent deletion of all associated records: notes, folders, Lamplight settings,
        entitlements, embeddings, artifacts, jobs, suggestions logs, connections, and usage
        telemetry. This is enforced by foreign key constraints with{' '}
        <code>ON DELETE CASCADE</code> at the PostgreSQL level, ensuring no orphaned data remains.
      </p>
      <p>
        <strong>Backup Retention</strong>: Database backups maintained by our infrastructure
        provider (Supabase) follow their standard retention schedule. Deleted data will be purged
        from backup systems within the backup rotation period (typically 7–30 days depending on the
        plan tier).
      </p>

      <hr />

      <h2>9. Your Privacy Rights and Controls</h2>
      <p>
        Depending on your location, you possess specific legal rights regarding your personal data.
        We have designed LivePsalms to make exercising these rights as simple and immediate as
        possible through built-in tools in your Profile settings.
      </p>

      <h3>9.1 Rights Under the GDPR (EEA/UK Residents)</h3>
      <p>
        If you are located in the European Economic Area or the United Kingdom, you have the
        following rights under the GDPR:
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Right</th>
              <th>Description</th>
              <th>How to Exercise in LivePsalms</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Right of Access</strong> (Art. 15)
              </td>
              <td>
                You have the right to obtain confirmation of whether we process your personal data
                and to receive a copy of that data.
              </td>
              <td>
                Use the "Export Data" button on your Profile page to download a complete JSON file
                of all your notes and folders. For a full data subject access request, email{' '}
                <a href="mailto:support@livepsalms.com">support@livepsalms.com</a>.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Right to Rectification</strong> (Art. 16)
              </td>
              <td>You have the right to correct inaccurate personal data.</td>
              <td>
                Edit your full name, date of birth, or avatar directly in your Profile settings.
                Edit note content at any time in the editor.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Right to Erasure</strong> (Art. 17)
              </td>
              <td>
                You have the right to request deletion of your personal data ("right to be
                forgotten").
              </td>
              <td>
                Delete individual notes, use "Forget my Lamplight history" to erase all AI data,
                or use "Delete Account" for complete erasure.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Right to Restriction</strong> (Art. 18)
              </td>
              <td>
                You have the right to restrict processing of your data in certain circumstances.
              </td>
              <td>
                Turn off the "Lamplight on" toggle to immediately halt all AI processing while
                preserving your existing data.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Right to Data Portability</strong> (Art. 20)
              </td>
              <td>
                You have the right to receive your data in a structured, commonly used,
                machine-readable format.
              </td>
              <td>
                Use the "Export Data" button to download your notes and folders as structured JSON.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Right to Object</strong> (Art. 21)
              </td>
              <td>
                You have the right to object to processing based on legitimate interests.
              </td>
              <td>
                Contact{' '}
                <a href="mailto:support@livepsalms.com">support@livepsalms.com</a> to object to
                any processing based on legitimate interests.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Right to Withdraw Consent</strong> (Art. 7)
              </td>
              <td>
                You have the right to withdraw consent at any time without affecting the lawfulness
                of prior processing.
              </td>
              <td>
                Disable Lamplight, delete your AI history, unsubscribe from newsletters, or delete
                your account.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Right to Lodge a Complaint</strong>
              </td>
              <td>
                You have the right to lodge a complaint with your local Data Protection Authority.
              </td>
              <td>
                Contact your local DPA. A list of EU DPAs is available at{' '}
                <a
                  href="https://edpb.europa.eu/about-edpb/about-edpb/members_en"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  edpb.europa.eu
                </a>
                .
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>9.2 Rights Under the CCPA/CPRA (California Residents)</h3>
      <p>
        If you are a California resident, you have the following rights under the California
        Consumer Privacy Act as amended by the California Privacy Rights Act:
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Right</th>
              <th>Description</th>
              <th>How to Exercise</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Right to Know</strong>
              </td>
              <td>
                You have the right to know what personal information we collect, use, disclose,
                and sell.
              </td>
              <td>
                This Privacy Policy provides comprehensive disclosure. For a personalized report,
                email{' '}
                <a href="mailto:support@livepsalms.com">support@livepsalms.com</a>.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Right to Delete</strong>
              </td>
              <td>
                You have the right to request deletion of your personal information.
              </td>
              <td>
                Use "Delete Account" in your Profile, or email{' '}
                <a href="mailto:support@livepsalms.com">support@livepsalms.com</a>.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Right to Correct</strong>
              </td>
              <td>
                You have the right to correct inaccurate personal information.
              </td>
              <td>
                Edit your profile directly, or email{' '}
                <a href="mailto:support@livepsalms.com">support@livepsalms.com</a>.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Right to Opt-Out of Sale/Sharing</strong>
              </td>
              <td>
                You have the right to opt out of the sale or sharing of your personal information.
              </td>
              <td>
                <strong>We do not sell or share your personal information.</strong> No opt-out is
                necessary.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Right to Limit Use of Sensitive PI</strong>
              </td>
              <td>
                You have the right to limit the use and disclosure of your sensitive personal
                information.
              </td>
              <td>
                Disable Lamplight to stop AI processing of your religious content. Delete your
                account to remove all data.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Right to Non-Discrimination</strong>
              </td>
              <td>
                You have the right not to be discriminated against for exercising your privacy
                rights.
              </td>
              <td>
                We will never deny you service, charge different prices, or provide different
                quality based on your exercise of privacy rights.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        We will respond to verifiable consumer requests within 45 days. If we need additional time
        (up to 45 more days), we will notify you of the extension and the reason.
      </p>

      <h3>9.3 Do Not Track / Global Privacy Control</h3>
      <p>
        LivePsalms does not track users across third-party websites and does not serve targeted
        advertising. We honor Global Privacy Control (GPC) signals. Because we do not sell or share
        personal information for advertising purposes, GPC signals do not change the functionality
        of our service, but we respect them as a valid expression of your privacy preferences.
      </p>

      <hr />

      <h2>10. Cookies and Tracking Technologies</h2>
      <p>
        We use a minimal set of browser storage technologies strictly necessary to provide our
        service. We do <strong>not</strong> use:
      </p>
      <ul>
        <li>Third-party analytics cookies (no Google Analytics, no Mixpanel, no Amplitude)</li>
        <li>Advertising or retargeting cookies</li>
        <li>Social media tracking pixels</li>
        <li>Browser fingerprinting technologies</li>
        <li>Cross-site tracking mechanisms</li>
      </ul>
      <p>The only browser storage we use is:</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Technology</th>
              <th>Type</th>
              <th>Purpose</th>
              <th>Duration</th>
              <th>Contains Personal Data?</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Supabase Auth Token</strong>
              </td>
              <td>localStorage</td>
              <td>
                Maintains your authenticated session so you don't have to log in on every page
                load.
              </td>
              <td>Until you sign out or the token expires.</td>
              <td>Yes (contains encrypted session identifier)</td>
            </tr>
            <tr>
              <td>
                <strong>Notepad Data (pre-login)</strong>
              </td>
              <td>localStorage</td>
              <td>
                Stores your notes and folders locally when you use the app without an account.
              </td>
              <td>Until you clear it or migrate to cloud.</td>
              <td>Yes (contains your note content)</td>
            </tr>
            <tr>
              <td>
                <strong>Intro Animation Flag</strong>
              </td>
              <td>sessionStorage</td>
              <td>
                Remembers that the home page intro animation has already played during this browser
                tab session.
              </td>
              <td>Until you close the browser tab.</td>
              <td>No</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Because we do not use non-essential cookies, we do not display a cookie consent banner. All
        storage mechanisms we use are strictly necessary for the functioning of the service.
      </p>

      <hr />

      <h2>11. Children's Privacy</h2>
      <p>
        LivePsalms is not directed at, marketed to, or intended for use by children under the age
        of 13 (or under the age of 16 in jurisdictions where the GDPR applies and the member state
        has not lowered the digital age of consent). We do not knowingly collect, solicit, or
        process personal information from children below these age thresholds.
      </p>
      <p>
        If we become aware that we have inadvertently collected personal data from a child without
        verifiable parental consent, we will take immediate steps to delete that information from
        our systems. If you are a parent or guardian and believe that your child has provided us
        with personal data without your consent, please contact us immediately at{' '}
        <a href="mailto:support@livepsalms.com">support@livepsalms.com</a>, and we will promptly
        investigate and remove the data.
      </p>
      <p>
        We do not use age verification mechanisms at registration. The optional "date of birth"
        field in the user profile is not used for age-gating purposes and is entirely voluntary.
      </p>

      <hr />

      <h2>12. Third-Party Links and Services</h2>
      <p>
        LivePsalms may contain links to third-party websites, services, or resources that are not
        operated by us. If you click on a third-party link, you will be directed to that third
        party's site. We strongly advise you to review the privacy policy of every site you visit.
      </p>
      <p>
        We have no control over and assume no responsibility for the content, privacy policies, or
        practices of any third-party sites or services. Our inclusion of links to third-party
        resources does not imply endorsement of their privacy practices.
      </p>

      <hr />

      <h2>13. Changes to This Privacy Policy</h2>
      <p>
        We may update this Privacy Policy from time to time to reflect changes in our data
        practices, the addition of new features, changes in applicable law, or updates to our
        sub-processor relationships. When we make changes:
      </p>
      <ol>
        <li>We will update the "Last Updated" date at the top of this document.</li>
        <li>
          For <strong>material changes</strong> — such as new categories of data collection, new
          sub-processors, or changes to how we use AI — we will provide prominent notice through one
          or more of the following methods:
          <ul>
            <li>A banner notification within the LivePsalms application.</li>
            <li>
              An email notification sent to the address associated with your account.
            </li>
            <li>A prominent announcement on our website.</li>
          </ul>
        </li>
        <li>
          Where required by law, we will obtain your renewed consent before implementing changes
          that affect the processing of your sensitive personal data.
        </li>
      </ol>
      <p>
        We encourage you to review this Privacy Policy periodically. Your continued use of
        LivePsalms after the effective date of any changes constitutes your acceptance of the
        updated policy, except where additional consent is required by law.
      </p>

      <hr />

      <h2>14. Legal Bases for Processing (GDPR)</h2>
      <p>For users in the EEA and UK, we process your personal data on the following legal bases:</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Processing Activity</th>
              <th>Legal Basis</th>
              <th>Justification</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Account creation and authentication</td>
              <td>Performance of contract (Art. 6(1)(b))</td>
              <td>
                Necessary to provide you with the LivePsalms service you signed up for.
              </td>
            </tr>
            <tr>
              <td>Storing and syncing your notes and folders</td>
              <td>Performance of contract (Art. 6(1)(b))</td>
              <td>Core functionality of the service you contracted for.</td>
            </tr>
            <tr>
              <td>Processing religious content in notes</td>
              <td>Explicit consent (Art. 9(2)(a))</td>
              <td>
                You explicitly consent by entering devotional content into a platform you know is
                designed for religious note-taking.
              </td>
            </tr>
            <tr>
              <td>Lamplight AI processing</td>
              <td>Explicit consent (Art. 9(2)(a) + Art. 6(1)(a))</td>
              <td>
                You explicitly opt in via the Lamplight toggle, with a recorded consent timestamp.
              </td>
            </tr>
            <tr>
              <td>Sending newsletter emails</td>
              <td>Consent (Art. 6(1)(a))</td>
              <td>You voluntarily subscribe and can unsubscribe at any time.</td>
            </tr>
            <tr>
              <td>Maintaining session security</td>
              <td>Legitimate interest (Art. 6(1)(f))</td>
              <td>Necessary to prevent unauthorized access and protect your account.</td>
            </tr>
            <tr>
              <td>System performance monitoring</td>
              <td>Legitimate interest (Art. 6(1)(f))</td>
              <td>
                Necessary to maintain service reliability and detect/prevent abuse.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <hr />

      <h2>15. California-Specific Disclosures</h2>
      <p>
        In the preceding 12 months, we have collected the following categories of personal
        information as defined by the CCPA:
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>CCPA Category</th>
              <th>Examples from LivePsalms</th>
              <th>Sold?</th>
              <th>Shared for Advertising?</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Identifiers</td>
              <td>Email address, full name, user ID</td>
              <td>No</td>
              <td>No</td>
            </tr>
            <tr>
              <td>Personal information under Cal. Civ. Code § 1798.80</td>
              <td>Name, email address</td>
              <td>No</td>
              <td>No</td>
            </tr>
            <tr>
              <td>Internet or network activity</td>
              <td>Session tokens, authentication logs</td>
              <td>No</td>
              <td>No</td>
            </tr>
            <tr>
              <td>Sensitive personal information (religious beliefs)</td>
              <td>
                Note content revealing religious beliefs, tradition preferences
              </td>
              <td>No</td>
              <td>No</td>
            </tr>
            <tr>
              <td>Inferences drawn from personal information</td>
              <td>
                AI-generated embeddings, connection scores, devotional content
              </td>
              <td>No</td>
              <td>No</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        <strong>
          We do not sell personal information. We do not share personal information for
          cross-context behavioral advertising. We have not done so in the preceding 12 months, and
          we have no plans to do so in the future.
        </strong>
      </p>

      <hr />

      <h2>16. Security Incident Response</h2>
      <p>
        In the unlikely event of a data breach that affects your personal information, we will:
      </p>
      <ol>
        <li>
          Notify affected users without undue delay and, where feasible, within 72 hours of
          becoming aware of the breach (as required by GDPR Article 33).
        </li>
        <li>Notify the relevant Data Protection Authority where required by law.</li>
        <li>
          Provide you with information about the nature of the breach, the categories of data
          affected, the likely consequences, and the measures we have taken or propose to take to
          address the breach.
        </li>
        <li>Offer guidance on steps you can take to protect yourself.</li>
      </ol>

      <hr />

      <h2>17. Contact Us</h2>
      <p>
        If you have any questions, concerns, requests, or complaints about this Privacy Policy, our
        data practices, or your privacy rights, please contact us:
      </p>
      <ul>
        <li>
          <strong>Email</strong>:{' '}
          <a href="mailto:support@livepsalms.com">support@livepsalms.com</a>
        </li>
        <li>
          <strong>Mailing Address</strong>: LivePsalms Privacy Team, 17130 Van Buren Blvd, Unit
          855, Riverside, CA 92504, USA
        </li>
        <li>
          <strong>Response Time</strong>: We aim to respond to all privacy-related inquiries within
          30 days (or 45 days for formal CCPA requests).
        </li>
      </ul>
      <p>
        For EEA/UK residents, if you are unsatisfied with our response, you have the right to lodge
        a complaint with your local Data Protection Authority.
      </p>

      <hr />

      <h2>References</h2>
      <ul>
        <li>
          [1]{' '}
          <a href="https://gdpr-info.eu/" target="_blank" rel="noopener noreferrer">
            EU General Data Protection Regulation (GDPR) — Full Text
          </a>
        </li>
        <li>
          [2]{' '}
          <a
            href="https://oag.ca.gov/privacy/ccpa"
            target="_blank"
            rel="noopener noreferrer"
          >
            California Consumer Privacy Act (CCPA/CPRA) — California Attorney General
          </a>
        </li>
        <li>
          [3]{' '}
          <a
            href="https://artificialintelligenceact.eu/article/50/"
            target="_blank"
            rel="noopener noreferrer"
          >
            EU Artificial Intelligence Act — Article 50: Transparency Obligations
          </a>
        </li>
        <li>
          [4]{' '}
          <a href="https://supabase.com/legal/dpa" target="_blank" rel="noopener noreferrer">
            Supabase Data Processing Addendum (DPA)
          </a>
        </li>
        <li>
          [5]{' '}
          <a
            href="https://developers.openai.com/api/docs/guides/your-data"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenAI Platform — Data Residency and Processing Regions
          </a>
        </li>
        <li>
          [6]{' '}
          <a href="https://www.voyageai.com/tos" target="_blank" rel="noopener noreferrer">
            Voyage AI Terms of Service — Section 3: Content and Models
          </a>
        </li>
        <li>
          [7]{' '}
          <a
            href="https://developers.openai.com/api/docs/guides/your-data"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenAI Platform — Data Controls: Training, Retention, and Abuse Monitoring
          </a>
        </li>
        <li>
          [8]{' '}
          <a
            href="https://supabase.com/docs/guides/platform/regions"
            target="_blank"
            rel="noopener noreferrer"
          >
            Supabase Platform Regions Documentation
          </a>
        </li>
        <li>
          [9]{' '}
          <a
            href="https://secureprivacy.ai/blog/privacy-laws-2026"
            target="_blank"
            rel="noopener noreferrer"
          >
            Privacy Laws 2026: Global Changes, Enforcement &amp; Compliance Guide
          </a>
        </li>
        <li>
          [10]{' '}
          <a
            href="https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai"
            target="_blank"
            rel="noopener noreferrer"
          >
            EU AI Act — Regulatory Framework Overview
          </a>
        </li>
      </ul>
    </LegalPage>
  );
}
