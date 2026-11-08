# Code review checklist

Every pull request is reviewed against this list.

## 1. Correctness
- Does it do what the linked issue asks? Are edge cases handled (zero amounts, rounding, empty lists, other currencies, closed periods)?
- For accounting changes: do debits still equal credits? Are posted entries left untouched?

## 2. Security
- Is every query scoped to the current organisation?
- Does every endpoint check the right permission?
- Is all input validated? No secrets or real data in the code or logs.

## 3. Tests
- New rules have unit tests; new endpoints have API tests. Bug fixes include a test that fails without the fix.

## 4. Readability
- Clear names, small functions, no dead code. Business rules live in `packages/shared` or services, not in controllers or components.

## 5. User experience
- All text goes through i18n, and the layout works right-to-left (Arabic).
- Keyboard and screen-reader friendly; works in light and dark mode and on small screens.
- Animations use only `transform` / `opacity` and respect reduced motion.

## 6. Performance
- No N+1 database queries; big lists are paginated or virtualised; heavy code is lazy-loaded.

## How feedback is written
- Be kind and specific. Explain *why*, and suggest a fix.
- Label comments **must-fix**, **suggestion** or **question**.
