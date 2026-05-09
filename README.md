# Mail Club

Real mail for real friends.

Mail Club is a private postcard club prototype built with Expo React Native, TypeScript, and Expo Router. This v0.1 app is designed to run in Expo Go and be buildable with EAS for iOS/TestFlight.

## Run locally

```bash
npm install
npx expo start
```

Open the project in Expo Go, or press `i` from the Expo CLI to launch the iOS simulator.

## Build with EAS

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --platform ios
```

The app config uses the placeholder bundle identifier `com.mailclub.app`. Replace it with the real Apple Developer Bundle ID before submitting to TestFlight.

## What is mocked in v0.1

- No backend or authentication.
- No real payments or stamp purchases.
- No real postcard fulfillment.
- Friends, routes, milestones, and My Mail Card data are mock data.
- Sending a postcard deducts local demo stamps and saves mock postcard history in AsyncStorage.
- Add Friend and postcard invitation flows show local prototype success states.
- Photo selection uses `expo-image-picker` for the postcard preview only.

## App Store checklist

- Apple Developer account.
- Real Bundle ID.
- Final App Store icon and splash assets.
- App Store screenshots for supported iPhone sizes.
- Privacy Policy URL.
- App Privacy answers in App Store Connect.
- TestFlight build.
- No real payment or fulfillment in v0.
- If selling stamps later, decide whether to use Apple In-App Purchase or external payment depending on whether Apple treats the purchased item as a physical good/service. Verify before launch.
- Real address validation.
- User address vault.
- Backend.
- QR invite claiming.
- Postcard fulfillment vendor integration such as Lob or PostGrid.
- Payments and stamp purchases.
- Account deletion.
- Push notifications.

## Launch copy constraint

For this prototype, UI copy uses "queued" and "demo send" language where fulfillment would otherwise be implied. For a public App Store release, integrate real postcard fulfillment or clearly position the app as early access/waitlist.
