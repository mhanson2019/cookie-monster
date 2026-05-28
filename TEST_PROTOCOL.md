# Cookie Monster — Pre-Launch Config Test Protocol

Run these tests manually before submitting to the Chrome Web Store.
Each test takes ~5 minutes. Total: ~45 minutes.

---

## Setup

1. Open chrome://extensions, reload Cookie Monster
2. Open the Service Worker console (click "Service Worker" link on the extension card)
3. Keep the console open throughout

---

## Test A — All settings ON (minimal deletion)

**Configure:**
- keepShoppingCarts: true
- keepSocialLogins: true
- keepDisplayPrefs: true
- keepLiveChat: true
- keepSubscriptions: true
- keepLocalization: true
- adTolerance: 5 (keep all ads)
- loginPersistence: 5
- googleTrust: 5
- deletionMode: ask

**Set config in console:**
```js
chrome.storage.local.set({ userConfig: {
  keepShoppingCarts: true, keepSocialLogins: true, keepDisplayPrefs: true,
  keepLiveChat: true, keepSubscriptions: true, keepLocalization: true,
  adTolerance: 5, loginPersistence: 5, googleTrust: 5,
  deletionMode: 'ask', onboardingComplete: true
}})
```

**Visit these sites and check results:**
- [ ] google.com — Google cookies should be SAFE (not flagged)
- [ ] facebook.com — Facebook auth cookies should be SAFE
- [ ] amazon.com — Cart and session cookies should be SAFE
- [ ] intercom.com — Intercom cookies should be SAFE
- [ ] any Shopify store — Shopify cart cookies should be SAFE

**Pass criteria:** Zero auto-deletions. Flagged count should be low (0-5 truly unknown cookies max per site).

---

## Test B — All settings OFF (maximum deletion)

**Set config in console:**
```js
chrome.storage.local.set({ userConfig: {
  keepShoppingCarts: false, keepSocialLogins: false, keepDisplayPrefs: false,
  keepLiveChat: false, keepSubscriptions: false, keepLocalization: false,
  adTolerance: 1, loginPersistence: 1, googleTrust: 1,
  deletionMode: 'strict', onboardingComplete: true
}})
```

**Visit these sites:**
- [ ] forbes.com — should flag 20+ cookies, auto-delete high severity
- [ ] cnn.com — should flag 15+ cookies
- [ ] huffpost.com — should flag 20+ cookies

**Pass criteria:** Badge shows significant numbers. Deletion log populates. No crashes or silent failures.

---

## Test C — Social login protection

**Configure with keepSocialLogins: true, everything else default:**
```js
chrome.storage.local.set({ userConfig: {
  keepShoppingCarts: true, keepSocialLogins: true, keepDisplayPrefs: true,
  keepLiveChat: false, keepSubscriptions: true, keepLocalization: true,
  adTolerance: 2, loginPersistence: 3, googleTrust: 3,
  deletionMode: 'auto', onboardingComplete: true
}})
```

**Steps:**
1. Log into a site using "Login with Google" (e.g. any site with Google OAuth)
2. Visit a news site like forbes.com
3. Navigate back to the Google-login site
4. [ ] Verify you are still logged in

**Pass criteria:** Google auth cookies survived. You were not logged out.

---

## Test D — Deletion mode: flag only

**Set deletionMode to 'flag':**
```js
chrome.storage.local.set({ userConfig: {
  keepSocialLogins: true, keepShoppingCarts: true, keepSubscriptions: true,
  keepLocalization: true, keepDisplayPrefs: true, keepLiveChat: false,
  adTolerance: 2, loginPersistence: 3, googleTrust: 3,
  deletionMode: 'flag', onboardingComplete: true
}})
```

**Visit forbes.com**
- [ ] Nothing was auto-deleted (deletion log should be empty for this visit)
- [ ] Popup shows flagged cookies available for manual deletion
- [ ] Badge shows flagged count

**Pass criteria:** No automatic deletion. All flagged cookies visible in popup for manual review.

---

## Test E — Storage cap

**In console, check accumulator size:**
```js
Object.keys(await new Promise(r => chrome.storage.local.get('global_accumulator', r).then ? chrome.storage.local.get('global_accumulator').then(r) : r({}))).length
```

Or simpler:
```js
chrome.storage.local.get('global_accumulator', r => console.log(Object.keys(r.global_accumulator || {}).length))
```

After visiting 10+ sites:
- [ ] Flagged bucket does not exceed 1000 entries
- [ ] Safe bucket does not exceed 500 entries
- [ ] Auto-deleted bucket does not exceed 500 entries

---

## Test F — Settings page saves and takes effect immediately

1. Open settings page (gear icon in popup)
2. Change deletionMode to 'strict'
3. Click Save
4. WITHOUT reloading the extension, visit a site
5. [ ] Strict deletion behavior applies immediately (more cookies auto-deleted than in auto mode)

**Pass criteria:** No extension reload required for settings to take effect.

---

## Sign-off checklist

- [ ] Test A passed (all settings on — minimal false positives)
- [ ] Test B passed (all settings off — maximum detection)
- [ ] Test C passed (social logins not broken)
- [ ] Test D passed (ask mode works correctly)
- [ ] Test E passed (storage caps enforced)
- [ ] Test F passed (settings take effect immediately)
- [ ] Privacy policy hosted at public URL
- [ ] Store screenshots created (5 screenshots)
- [ ] Store listing description finalized

**Ready to submit when all boxes checked.**
