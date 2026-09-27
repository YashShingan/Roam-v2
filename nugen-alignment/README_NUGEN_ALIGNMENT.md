# How to Fine-Tune & Align a Master Model on Nugen Intelligence (`nugen.in`)

This directory contains the Master Domain Specification and Multi-Task Supervised Dataset required to align a foundation model (e.g. `llama-v3p3-70b-instruct`) with Roam v3's complete intelligence stack.

---

## 1. Files in this Directory

| File Name | Purpose | What It Covers |
|---|---|---|
| [`nugen_domain_guidelines.md`](./nugen_domain_guidelines.md) | **Master Domain Specification** | **The 7 Core Operational Pillars**: Meal Anchor Biology, Cultural/Temple Protocols (dress codes, leather bans, darshan cutoffs), Transit Realities (peak-hour train crush, auto refusals, ghat landslides), Culinary Heritage & Monsoon Food Safety, Honest ASI Pricing & Anti-Scam Shield, Biological Fatigue/Wet-Bulb Pacing, and Causal Weather Digital Twin Dynamics. |
| [`nugen_causal_tuning.jsonl`](./nugen_causal_tuning.jsonl) | **Multi-Task Supervised Tuning Dataset** | **22+ High-Density Scenarios**: Weather stress-tests across 12 Indian cities, temple etiquette queries (Padmanabhaswamy, Kashi), Mumbai local train peak direction advice, monsoon street food safety warnings, ASI verified ticket rates, Hinglish conversational trip generation, delay compression, and cross-day stop swapping. |

---

## 2. Option A: Web Console Walkthrough (Recommended)

1. **Log in to Nugen Intelligence:**
   - Go to [console.nugen.in](https://console.nugen.in) (or [nugen.in](https://nugen.in)) and sign in with your developer account.

2. **Step 1: Upload the Master Domain Specification (`/documents`):**
   - In the left sidebar, click **Documents** or **Knowledge Base**.
   - Click **Upload Document**.
   - Select and upload [`nugen_domain_guidelines.md`](./nugen_domain_guidelines.md).
   - Once processed, the document status will show `Ready` or `Indexed`. Note down the `document_id`.

3. **Step 2: Upload the Multi-Task Dataset (`/datasets`):**
   - In the left sidebar, click **Datasets** or **Alignment Data**.
   - Click **Create Dataset** $\rightarrow$ choose **Instruction / Chat Completions (`.jsonl`)**.
   - Select and upload [`nugen_causal_tuning.jsonl`](./nugen_causal_tuning.jsonl).

4. **Step 3: Create an Alignment Project (`/alignments`):**
   - In the left sidebar, navigate to **Alignments** or **Domain Alignment**.
   - Click **New Alignment Project**:
     - **Project Name:** `roam-master-domain-ai`
     - **Base Model:** Select `llama-v3p3-70b-instruct` (or `qwen-v2p5-7b-instruct` if on a lighter quota).
     - **Knowledge Document:** Attach `nugen_domain_guidelines.md` (uploaded in Step 1).
     - **Training Dataset:** Attach `nugen_causal_tuning.jsonl` (uploaded in Step 2).
     - **Target Evaluation Metric:** Select `JSON Schema Adherence & Causal Logic`.
     - **Target Score:** Set to `92%` or higher.
   - Click **Start Alignment**.

5. **Step 4: Monitor & Deploy:**
   - The job will display status: `Queued` $\rightarrow$ `Aligning` $\rightarrow$ `Evaluating` $\rightarrow$ `Completed`.
   - Once completed, click **Deploy Model**.
   - Copy the deployed **Aligned Model ID** (e.g. `nugen-aligned-roam-master-v1`).

---

## 3. Option B: Programmatic Alignment via cURL / REST API

If you prefer using the terminal or CI/CD pipeline:

### Step 1: Upload the Domain Document
```bash
curl --request POST \
  --url https://api.nugen.in/api/v3/documents \
  --header "Authorization: Bearer YOUR_NUGEN_API_KEY" \
  --header "Content-Type: multipart/form-data" \
  --form "file=@./nugen_domain_guidelines.md" \
  --form "name=roam_master_domain_spec"
```
*(Copy the returned `document_id`)*

### Step 2: Create the Alignment Project
```bash
curl --request POST \
  --url https://api.nugen.in/api/v3/alignments \
  --header "Authorization: Bearer YOUR_NUGEN_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "name": "roam-master-domain-ai",
    "base_model": "llama-v3p3-70b-instruct",
    "document_ids": ["YOUR_DOCUMENT_ID"],
    "target_score": 0.92,
    "task": "causal_inference"
  }'
```
*(Copy the returned `alignment_id`)*

### Step 3: Check Alignment Status
```bash
curl --request GET \
  --url https://api.nugen.in/api/v3/alignments/YOUR_ALIGNMENT_ID/status \
  --header "Authorization: Bearer YOUR_NUGEN_API_KEY"
```
When status becomes `completed`, it returns `aligned_model_id`.

---

## 4. Activating Your Aligned Model in Roam v3

Once deployed, add your model credentials to `C:\Code\Roam\.env.local`:

```env
# ─── Nugen Domain-Aligned AI ──────────────────────────────────────
NUGEN_API_KEY=your_nugen_inference_token_here
NUGEN_MODEL=your_aligned_model_id_here
NUGEN_MODEL_ENDPOINT=https://api.nugen.in/api/v3/chat/completions
```

### What You Get:
1. **Weather-Driven Digital Twin:** When you click the **Twin** simulation button in the Day Planner cockpit or ask *"what if it rains 25mm"*, Roam will query your custom aligned Nugen model for causal hazard cascades.
2. **Conversational Copilot:** You can speak in natural English or Hinglish (*"Bhai weekend pe Pune me mast heritage plan bana de"*), and Nugen produces deterministic travel actions with zero hallucination.
3. **Zero-Downtime Guarantee:** If the external Nugen endpoint is ever unreachable or rate-limited, Roam automatically falls back to Groq Llama 3.3 and deterministic heuristic matrices.
