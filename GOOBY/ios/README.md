# Gooby’s Cozy Burrow iOS shell

This is the generated Capacitor 8 CocoaPods shell for the offline web build. The bundle identifier is `com.gooby.pet`, the display name is Gooby’s Cozy Burrow, and the rabbit remains named Gooby. `dist` is copied into the app only by `npx cap sync ios`. `Pods/`, Xcode build output, and `App/App/public/` are generated and must remain uncommitted.

## macOS prerequisites

- Node 22 from `GOOBY/.nvmrc`
- A Capacitor-supported Xcode release with iOS 15 or newer SDK support
- CocoaPods available as `pod`

From `GOOBY/`, refresh and validate the shell with:

```sh
npm ci
npm run build
npx cap sync ios
npm run ci:native-check
npm run ci:workflow-check
cd ios/App
pod install
open App.xcworkspace
```

Always open/build `App.xcworkspace` after `pod install`, not `App.xcodeproj`.

## Unsigned CI artifact

The `unsigned` job in `.github/workflows/gooby-ios.yml` always disables code signing, archives `App.app`, and packages `Payload/App.app` as `Gooby-unsigned.ipa`. This is a build artifact only. It cannot be installed on normal devices or distributed until it is re-signed with a valid Apple certificate and matching provisioning profile.

### Re-signing an unsigned IPA

Re-signing is a macOS release operation, not a rename or zip-only operation. Use an Apple distribution/development certificate whose team matches a provisioning profile for `com.gooby.pet`; install the profile, replace `Payload/App.app/embedded.mobileprovision`, sign embedded frameworks/extensions first, sign `App.app` last with the profile’s entitlements, verify with `codesign --verify --deep --strict --verbose=2`, then repackage the `Payload` directory. An Xcode archive/export or a vetted release tool is preferred because it performs the same nested-signature and entitlement work consistently.

Never reuse the unsigned artifact as if it were signed. Confirm the final application identifier is exactly `${APPLE_TEAM_ID}.com.gooby.pet`, the profile team identifier matches the certificate, and the distribution method matches the intended device/ad hoc/App Store channel before installation or upload.

The equivalent macOS archive command, after the setup commands above and from `GOOBY/`, is:

```sh
xcodebuild archive \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$TMPDIR/Gooby-unsigned.xcarchive" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  DEVELOPMENT_TEAM="" \
  COMPILER_INDEX_STORE_ENABLE=NO
mkdir -p "$TMPDIR/Payload"
ditto "$TMPDIR/Gooby-unsigned.xcarchive/Products/Applications/App.app" "$TMPDIR/Payload/App.app"
(cd "$TMPDIR" && ditto -c -k --sequesterRsrc --keepParent Payload Gooby-unsigned.ipa)
```

## Optional signed artifact

The `signed` job runs only outside pull requests and only when all four signing secrets exist:

- `IOS_CERT_P12_BASE64`
- `IOS_CERT_PASSWORD`
- `IOS_PROVISIONING_PROFILE_BASE64`
- `APPLE_TEAM_ID`

It imports the certificate into an ephemeral keychain, verifies the profile application identifier is exactly `${APPLE_TEAM_ID}.com.gooby.pet` and its team identifier is exactly `APPLE_TEAM_ID`, manually signs the archive, packages `Gooby-signed.ipa`, and removes the keychain/profile in an `always()` cleanup step. The resulting distribution rights depend on the supplied profile.

## Optional TestFlight release

A push of a `gooby-v*` tag runs the `testflight` job only when the four signing secrets and all three App Store Connect API secrets exist:

- `ASC_API_KEY_ID`
- `ASC_API_ISSUER_ID`
- `ASC_API_KEY_P8_BASE64`

The signing identity/profile must be valid for App Store distribution and pass the same exact bundle/team checks. CI exports with the `app-store-connect` method, uploads through `xcrun altool`, and removes both signing material and the temporary API key in an `always()` cleanup step.

## Linux verification boundary

Linux can run `npm run ci:native-check` to parse and validate the Capacitor config, plists, privacy manifest, Xcode project, asset slots, and artifact exclusions. Linux cannot run CocoaPods/Xcode or produce a verified IPA; archive success is established only by the macOS workflow.

The 2026-07-17 final Linux verification passed the 11 semantic native-checker regression tests, `npm run ci:native-check`, `npm run ci:workflow-check`, and direct `actionlint`. Two consecutive `npx cap sync ios` runs produced the identical generated-tree SHA-256 `6e5bce2a911f2ca754c63db5eb8b414a6bdce6a34f87470560371b5adeeeb6a7`. These results establish deterministic checked-in inputs only; they do not replace the protected macOS archive/sign/export gates.
