# Design QA - Newsletter Center

- Source visual truth: `C:\Users\LOQ\AppData\Local\Temp\codex-clipboard-38f52f15-4b6e-4a8b-b536-eb4c1dc77b70.png`
- Implementation screenshot: `C:\Users\LOQ\Documents\OZK-TOBACCO\tobacco-web\tmp\design-qa\newsletter-center-desktop.png`
- Mobile screenshot: `C:\Users\LOQ\Documents\OZK-TOBACCO\tobacco-web\tmp\design-qa\newsletter-center-mobile.png`
- Combined comparison: `C:\Users\LOQ\Documents\OZK-TOBACCO\tobacco-web\tmp\design-qa\comparison.png`
- Desktop viewport: 1920 x 1020
- Mobile viewport: 390 x 844 (375px document viewport)
- State: pricing route, light theme, signed-out fallback data

## Full-view comparison evidence

The previous screen exposed many equal-weight operational buttons before the pricing groups. The revised screen intentionally replaces that hierarchy with one newsletter workflow: status and last inventory sync, four ordered steps, four edition cards, primary daily actions, then price editing. The existing sidebar, brand logo, cream/gold tokens, RTL direction, and dense administrative character are preserved.

## Focused region comparison evidence

The header, edition cards, and primary command area were reviewed at desktop size where their text and control states are readable. Mobile was reviewed separately to verify the collapsed sidebar, one-column workflow, card widths, and absence of horizontal overflow.

## Required fidelity surfaces

- Fonts and typography: Existing Segoe UI/Tahoma Arabic stack is retained. Headings, status labels, card titles, and supporting copy have distinct weights and readable line heights.
- Spacing and layout rhythm: The screen now follows a consistent 18px section rhythm with compact cards and aligned four-column desktop grids. Mobile collapses to one column and begins main content after a 164px compact navigation area.
- Colors and visual tokens: Existing OZK cream, black, and gold variables are reused. The black hero establishes the newsletter identity without changing the application's light/dark theme behavior.
- Image quality and asset fidelity: The supplied OZK logo asset is reused without substitution, stretching, or generated replacements.
- Copy and content: Navigation and page title use `نشرة الأسعار`. Actions distinguish dollar, Syrian, wholesale, retail, and Wazari editions and explain the inventory rule in plain Arabic.

## Findings

No actionable P0, P1, or P2 visual differences remain. The major changes from the source are intentional workflow improvements requested by the user, not fidelity defects.

## Interaction and responsive checks

- Pricing route and newsletter links render correctly.
- Wholesale/retail mode toggle changes selected state.
- Light/dark theme toggle works.
- Additional tools disclosure opens correctly.
- Desktop and mobile have no horizontal document overflow.
- Browser console errors checked: none.

## Comparison history

- Initial mobile capture: the shared sidebar occupied most of the first viewport.
- Fix applied: added a pricing-route shell class and compact mobile sidebar/navigation rules.
- Post-fix evidence: sidebar reduced to 164px and the newsletter center starts within the first mobile viewport; no horizontal overflow remains.

## Follow-up polish

- P3: After deployment, repeat the visual check while signed in so live inventory counts and full pricing groups can be observed in the final production state.

final result: passed
