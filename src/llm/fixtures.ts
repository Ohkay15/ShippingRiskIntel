/**
 * Shared text fixtures for extraction tests and manual demos. They model
 * the four document types at the level of detail the mock provider (and a
 * future live provider) can actually read.
 */

/** A well-formed commercial invoice — every labeled field extractable. */
export const SAMPLE_COMMERCIAL_INVOICE = `
COMMERCIAL INVOICE
Invoice No: INV-2026-0142

Cargo Description: Boxed consumer electronics
HS Code: 8471.30
Hazard Class: none

Packing Type: Double-wall cartons, palletized
ISPM-15 Cert Present: yes
DG Cert Present: no
Cert Expiry Date: 2027-06-30

Carrier ID: car-001
Carrier: Seed Carrier 2
Safety Rating: 2
Claims Rating: 3

Origin: Chicago, IL
Destination: Dallas, TX
Mode: road
Lane ID: US-IL-TX-01
Lane Conditions: none_reported
Notes: Standard weekly lane

Load Type: Sealed-Dedicated
Handling Points: 0

Declared Value: $120,000.00
Fragility Class: medium

Delay Sensitivity: jit

Escalation Exposure: contained
Escalation Contact: ops@example.com

Insurance Coverage: $150,000.00
Liability Limit: $100,000.00
`;

/**
 * A garbled upload — scanner noise with numbers but no readable labels.
 * Extraction must find nothing the gate can trust, so this document must
 * route its record to Needs review, never to scoring on guesses.
 */
export const GARBLED_DOCUMENT = `
? ;;; 0x00 F1E ---INV/0ICE~ 84?71.3#0 --
^^$ 12O,OOO.OO USD ## ORIGIN>> ??DEST??
::: MODE 8A == LANE %US-?TX%%
DG??CERT ~~ YES?NO ~~ ISPM 15?
total: ###.## , value maybe 999?
`;
