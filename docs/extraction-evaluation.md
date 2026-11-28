# Extraction development evaluation — 28 November 2026

Model: **gemini-3.5-flash-lite**. Input: **25 typed, fictional accounts** (7 English, 8 Hindi/Hinglish and 10 Kannada/mixed English). All 25 requests returned a live model response. No real worker records or microphone recordings were sent.

## Method

The baseline uses WorkEcho's basic extraction rules. The model path uses the same source-excerpt validation as the server and a conservative filter for quoted unknown answers. Each account has five expected fields. A field matches only an accepted exact excerpt, or null when the expected detail is unknown. A useful span with an extra preposition still counts as a mismatch under this strict score.

These are development regression fixtures, not a held-out test set. They informed field descriptions and the unknown-answer filter. The first 20 observed proposals were revalidated after the filter was added; it removed one Kannada admission of not remembering a year. The remaining five requests used the filter directly. No claim about speech-recognition accuracy, real-world worker accuracy or target-user usability follows from these numbers.

## Results

| Input group | Accounts | Rules: matched fields | Gemini: matched fields |
| --- | ---: | ---: | ---: |
| English | 7 | 34/35 (97.1%) | 34/35 (97.1%) |
| Hindi / Hinglish | 8 | 20/40 (50%) | 38/40 (95%) |
| Kannada / mixed English | 10 | 23/50 (46%) | 47/50 (94%) |
| Total | 25 | 77/125 (61.6%) | 119/125 (95.2%) |

The served results left **42/42 expected unknown fields blank** after validation; the rules baseline also left all expected unknowns blank. Every returned model field was checked against its source. Human confirmation remains part of the workflow.

## Strict-match differences

| Fixture | Field | Accepted excerpt | Observed result |
| --- | --- | --- | --- |
| en-01 | period | two monsoons before lockdown | for two monsoons before lockdown |
| hi-04 | landmark | पुराने बस अड्डे | पुराने बस अड्डे के पास |
| hi-08 | landmark | railway crossing | railway crossing के पास |
| kn-01 | landmark | ರೈಲ್ವೆ ಗೇಟ್ | ರೈಲ್ವೆ ಗೇಟ್ ಹತ್ತಿರ |
| kn-04 | landmark | ಹಳೆಯ ಬಸ್ ನಿಲ್ದಾಣ / ಹಳೆಯ ಬಸ್ ನಿಲ್ದಾಣದ | ಹಳೆಯ ಬಸ್ ನಿಲ್ದಾಣದ ಹತ್ತಿರ |
| kn-06 | landmark | ಹಳೆಯ ಸೇತುವೆ | ಹಳೆಯ ಸೇತುವೆ ಹತ್ತಿರ |

The six differences above retain surrounding location/time wording. The outputs remain available for review rather than being silently rewritten to improve the score.

## Reproduction and source

- [Fixtures](../tests/fixtures/extraction-cases.json)
- [Observed outputs and metrics](extraction-results.json)
- [Server adapter](../server/intelligence.mjs)
- [Opt-in evaluation script](../scripts/evaluate-extraction.mjs): run with a server-side GEMINI_API_KEY and GEMINI_MODEL. It performs 25 real requests and writes local results; never place a credential in command arguments or commit it.

Hosted availability is controlled separately by the feature flags and user consent described in [architecture](architecture.md#gemini-configuration-and-quotas). These isolated evaluation calls do not mean AI is enabled on the public website.
