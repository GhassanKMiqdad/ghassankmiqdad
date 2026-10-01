# NestHire — Project Kickoff & Team Alignment

`NestHire_Project_Kickoff_2026.pptx` is the internal kickoff deck: 28 slides (16:9) with speaker notes on every slide, sized for a 60–90 minute meeting (about 75 minutes of content plus 10–15 minutes of Q&A).

**Status: Draft v0.1.** The deck was built from the kickoff brief only. No NestHire project documents, brand files, team roster or code were available, so anything the brief did not establish is labelled on the slide itself.

| Label | Meaning |
|---|---|
| `PLANNED` | Intended feature or module. Not built. |
| `PROPOSED` | A recommendation the team still has to agree on (architecture, plan, conventions, Sprint 1). |
| `NEEDS CONFIRMATION` | Not yet validated against project documents. |
| `FUTURE VISION` | Long-term direction. |
| `TARGET DESIGN` / `CORE CONCEPT` / `CORE RULE` | A design intent or principle taken from the brief. |

## Deck structure

| # | Slide | Content basis |
|---|---|---|
| 1 | Cover | Brief. Logo placeholder: Needs Confirmation |
| 2 | Why Are We Here? | Brief (7 goals, 8 questions) |
| 3 | Where We Are Now | Brief (Idea/Planning current, Development not started) |
| 4 | The Big Vision | Draft vision wording derived from the brief: Needs Confirmation |
| 5 | The Problem | Brief's problem list. No statistics |
| 6 | The NestHire Solution | Brief's flow (Requirements → … → Human Decision) |
| 7 | Who Is NestHire For? | Brief's user groups. Personas and scope: Needs Confirmation |
| 8 | The NestHire Product | Brief's 11 modules, grouped. MVP and Copilot scope: Needs Confirmation |
| 9 | How NestHire Works | Brief's 10-step proposed product flow |
| 10 | Job Intelligence | Brief. Requirement weighting: Needs Confirmation |
| 11 | Candidate Intelligence | Brief. Input types and data sources: Needs Confirmation |
| 12 | Evidence-Based Employment | Brief's Claim → Evidence → Inference → Confidence → Decision. Examples are illustrative |
| 13 | Explainable Matching | Brief's six questions. "78%" is illustrative |
| 14 | Confidence ≠ Candidate Quality | Brief |
| 15 | AI Assists. Humans Decide. | Brief. The three human-role bullets are derived from Human Oversight |
| 16 | Responsible AI | Brief's principles and exclusions. Policy details: Needs Confirmation |
| 17 | Proposed System Architecture | Brief's layers and technologies, all marked proposed |
| 18 | Team Structure | Brief's roles. **Names: Needs Confirmation** |
| 19–20 | Who Owns What? | Draft responsibilities at role level, to confirm in the meeting |
| 21 | How We Will Build NestHire | Brief's 8 phases. Phase contents are proposed. Dates: Needs Confirmation |
| 22 | How We Work as a Team | Brief's workflow plus proposed GitHub conventions |
| 23 | Task Management | Brief's chain plus a proposed Definition of Done |
| 24–25 | First Development Sprint | Proposed Sprint 1, tied to Phase 1 and the proposed architecture |
| 26 | Team Expectations | Brief |
| 27 | Open Decisions | Everything that must be confirmed before or during Sprint 1 |
| 28 | What Happens After This Meeting? | Brief |

Slide 27 was added beyond the brief's outline. Because the deck had no source documents, the open decisions needed an owner and a date.

## Inputs needed for v0.2

- Official logo and brand guidelines. The current colours are a neutral placeholder theme, defined as tokens at the top of `build_deck.js`.
- Team roster: names mapped to roles, and whether Product is a separate role.
- Project documents (vision, requirements, research, architecture) to confirm or correct every `NEEDS CONFIRMATION` item.
- Any decided technologies, timeline or sprint length.
- Any existing code or prototypes, for context only.

## Speaker notes

The notes are in Arabic with English product terms and are set right-to-left. Each slide's notes contain:
1. what the meeting lead says,
2. the idea the team must understand,
3. the point to stress,
4. the transition to the next slide,

plus a suggested duration and a cumulative time. Slide 2's notes include the full run of show and a shortened 60-minute variant.

## Rebuilding

```bash
npm install          # pptxgenjs, jszip, react, react-dom, react-icons, sharp
node build_deck.js   # writes NestHire_Project_Kickoff_2026.pptx
```
