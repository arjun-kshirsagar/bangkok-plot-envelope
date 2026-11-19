# Phase 1 research summary: zone ย.10, Sukhumvit (Phrom Phong - Thong Lo)

Written 2026-11-20. Machine-readable version: `rules/bangkok-zone.json`. Sources: `docs/SOURCES.md`. Judgement calls: `docs/DECISIONS.md`.

## 1. Which law applies in November 2026

- **Zoning**: Bangkok Comprehensive Plan B.E. 2556 (2013), a ministerial regulation (Royal Gazette 16 May 2013). Its own ข้อ 1 said "five years"; the Town Planning Act (No.4) B.E. 2558 removed that expiry and carried existing plans forward (history). The Town Planning Act B.E. 2562 (in force 25 Nov 2019) then repealed the 2518 Act and its amendments, and its transitional provisions keep plans enforced by ministerial regulation before that date in force until replaced by a Ministry of Interior notification or a local ordinance; a successor Bangkok plan would be a ข้อบัญญัติกรุงเทพมหานคร (not verified from primary text). The 4th-revision draft was approved by the Bangkok provincial committee on 9 Apr 2026 and publicly posted Aug-Nov 2026; promulgation is expected in 2027. So the 2013 plan is the law today.
- **Building envelope**: Building Control Act B.E. 2522 regulations: Ministerial Regulation No. 55 (2000, general setbacks and height), No. 33 (1992, high-rise and extra-large buildings), plus the Bangkok Building Control Bylaw B.E. 2544 (2001), which repeats the national rules and adds Bangkok-specific open-space minima.

## 2. The zone

**ย.10 (Y.10), very-high-density residential, brown.** Plan ข้อ 17. Official BMA GIS sub-zones ย.10-4 to ย.10-10 cover the Sukhumvit sois from about Soi 22 to Ekkamai on both sides of Sukhumvit Road, including Phrom Phong and Thong Lo BTS. Asok itself is พ.5 (commercial, FAR 10). Map focus: sub-zone **ย.10-4** (Soi 31-55, north side), centre 100.5724 E, 13.7363 N, 2.85 km2. Boundaries come from BMA's ArcGIS service and are approximate (+/-50-100 m), not parcel-accurate. Geometry note for the builder: the ย.10-7 polygon (Phrom Phong / Thong Lo BTS) has an interior ring (a hole; contents not identified, probably an island of another zone), so point-in-polygon and "plot inside zone" tests must handle polygons with holes, not just exterior rings.

| Item | Value | Source |
|---|---|---|
| FAR | 8 : 1 | BMA-CP ข้อ 17(1); BMA-GIS LUP_FAR |
| OSR | open space >= 4% of gross floor area, >= 50% of it permeable | BMA-CP ข้อ 17(2) |
| Condo permitted | yes, no road-width condition | ข้อ 17 lists only prohibited uses |
| FAR bonus | up to +20% combined, not applied | ข้อ 51-57 |

## 3. The rule chain for a condo (what the engine does, in order)

1. **Zone**: plot area A -> GFA cap = 8A. Open-space floor = max(30% of A [Bangkok bylaw ข้อ 52(1), MR-33 ข้อ 6], 4% of GFA [plan]).
2. **Regime test**: if the target height >= 23 m (ground to roof-deck floor) or GFA >= 10,000 m2, the building is "high-rise / extra-large" and MR-33 applies (MR-33 ข้อ 1). At FAR 8 almost any condo plot above 1,250 m2 is extra-large by area.
3. **Road access (high-rise)**: one plot side >= 12 m on a public road with right-of-way >= 10 m (GFA <= 30,000 m2) or >= 18 m (> 30,000 m2), continuing to another road of that width; 12 m access strip (MR-33 ข้อ 2). Right-of-way, not carriageway.
4. **Setbacks**:
   - High-rise regime: 6.00 m from every boundary and every road, above and below ground (MR-33 ข้อ 4). This single offset replaces everything below.
   - Standard regime (< 23 m and < 10,000 m2): boundary edges 2 m if building <= 9 m, 3 m if 9-23 m, for walls with openings (MR-55 ข้อ 50; BMA ข้อ 54); plus 1 m / 2 m open space all round below / above 15 m (BMA ข้อ 55). Road edges: road < 6 m -> 3 m from centreline; buildings > 2 storeys or > 8 m: road < 10 m -> 6 m from centreline, 10-20 m -> 1/10 of width from the road edge, > 20 m -> 2 m from the edge (MR-55 ข้อ 41; BMA ข้อ 50).
5. **Height**: at any point, height <= 2 x horizontal distance to the far boundary of the nearest public road (MR-55 ข้อ 44; BMA ข้อ 49). Flat conservative cap = 2 x (right-of-way + front setback). Sloped version: H(x) = 2 x (W + x) for a point x metres behind the near road edge.
6. **Floors**: floors = floor(Hmax / 3.0 m). Legal minimum floor-to-floor for dwellings is 2.60 m (MR-55 ข้อ 22); 3.0 m is our default.
7. **Envelope** = setback footprint x height cap. **GFA** = footprint x floors, capped by FAR. **Binding rule** = whichever of height, FAR, or open space stops growth first.
8. **Fire road** (high-rise): a 6.00 m carriageway free of overhead cover around the building (MR-33 ข้อ 3); satisfied by keeping the 6 m band unroofed.
9. **Frontage check** (Bangkok bylaw ข้อ 52(6), ข้อ 53): a building > 2 storeys or > 8 m counts as "fronting the public way" only if its road-facing building line is longer than 1/8 of its outer perimeter and lies within 20 m of the public way; otherwise it must provide a 6 m deep front open space (12 m if > 3 storeys). Evaluated per massing, since a tower pushed to the back of a deep plot can fail it.
10. **Indicative parking deduction** (informational): 1 space per condo unit (BMA ข้อ 84(3)); common practice 1 per unit >= 60 m2 else 1 per 120 m2 (attributed to MR No. 7, unverified). At ~30 m2 per space, parking floors eat FAR, so the UI shows "indicative saleable GFA" next to the FAR GFA.
11. **Two blocks on one plot** (informational, MR-55 ข้อ 48): openings-to-openings walls 4 / 5 / 6 m apart by height class; only matters for twin-block templates.

## 4. Worked example: 1,600 m2 plot, 40 m x 40 m, facing a 12 m right-of-way soi, condo

| Step | Number |
|---|---|
| FAR 8 | GFA cap 12,800 m2 -> extra-large (>= 10,000), MR-33 regime |
| Open-space floor | max(30% x 1,600 = 480 m2, 4% x 12,800 = 512 m2) = 512 m2 -> footprint <= 1,088 m2; permeable >= 256 m2 |
| Road access | 12 m right-of-way >= 10 m ok; 40 m frontage >= 12 m ok; continuity to another >= 10 m road: user attests |
| Setback | 6 m all round -> footprint 28 m x 28 m = 784 m2 (49% coverage); open space 816 m2 (51%) ok |
| Height | front face 6 m behind the road edge: 2 x (12 + 6) = 36 m flat cap |
| Floors | 36 / 3.0 = 12 floors, 36.0 m |
| GFA | 784 x 12 = 9,408 m2 (73% of the 12,800 cap). **Height binds.** |
| Permeable | >= 50% of open space: 408 m2 if read strictly, 256 m2 as the hard minimum |

Sloped mode shows the lever: the rear face is 34 m behind the road edge, where the cap is 2 x (12 + 34) = 92 m, so a podium at the front with a tower set back from the road can approach the FAR cap (12,800 / 784 = 16.3 floors, i.e. 16 floors = 48 m needs 24 m to the far kerb, so a tower front face 12 m behind the near road edge).

Standard-regime alternative on the same plot (stay under 23 m and under 10,000 m2): road setback 1.2 m (1/10 of 12 m), boundary 3 m -> raw footprint 34 x 35.8 = 1,217 m2 (76%), cut to 1,120 m2 by the 30% rule; 7 floors x 3.0 = 21 m (< 23 m); GFA 7,840 m2. The high-rise route gives more area (9,408 vs 7,840) but costs the 6 m band on all sides.

## 5. Thresholds and what they trigger

| Threshold | Triggers |
|---|---|
| Height >= 23 m (roof-deck floor) or GFA >= 10,000 m2 (any floor or total) | MR-33: 6 m clearance all round incl. road; road right-of-way >= 10 m with 12 m frontage; 6 m fire road; FAR <= 10; open space 30% of plot. Also lifts, fire stairs, pressurised shafts (not modelled) |
| GFA > 30,000 m2 | road right-of-way >= 18 m |
| Height > 15 m | 2 m open space all round (BMA ข้อ 55) instead of 1 m |
| Height > 9 m | boundary setback for openings 3 m instead of 2 m |
| > 2 storeys or > 8 m | second-tier road setback (6 m from centreline on roads < 10 m, etc.) |
| Road < 6 m | 3 m from centreline for any building |
| Office > 10,000 m2 in ย.10 | road right-of-way >= 12 m or within 500 m of a rail station (plan ข้อ 17(10), ข้อ 36) |

## 6. What is uncertain (top items)

1. **Zone boundary**: the GIS polygons are BMA's digitisation of a 1:75,000 Gazette map. Near sub-zone edges (e.g. where ย.10 meets ย.9 at Soi 24-26 or พ.5 at Asok) the true parcel designation can differ. The UI must say "approximate".
2. **Height-rule interpretation**: flat cap at the front face vs per-point sloped envelope, and what counts as "highest part" (parapets, roof plant). We use the roof-deck level and the flat cap, both conservative, and disclose it.
3. **Open space composition**: three overlapping rules (30% of plot, 4% of GFA, 30% of largest floor) and the "50% permeable" clause whose base ("ของพื้นที่ว่าง") is ambiguous. We check max(30% plot, 4% GFA) and report permeable at 50% of the open space, with 50% of the required open space as the hard minimum.
4. **Road right-of-way data**: OSM rarely has `width`; the lanes-based estimate is a guess and the user must confirm the number from a survey or the BMA road register. Road continuity (MR-33 ข้อ 2) is attested, not computed.
5. **Plan currency**: the 2013 plan is law today but the 4th revision (expected 2027) renumbers zones and, per press, lowers FAR in some brown zones. Any result is "as of Nov 2026".
6. **Out of scope but real**: parking ratios (BMA ข้อ 84), EIA for condos, lift/fire-stair rules in MR-33 ข้อ 7 onward, and the plan's open-space (ล.) and road-project (ถนนสาย ก/ข) overlays, which can add a road-widening line that moves the road boundary (plan ข้อ 36 last paragraph).
