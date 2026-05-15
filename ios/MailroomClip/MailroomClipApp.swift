//
//  MailroomClipApp.swift
//  MailroomClip — App Clip target for the Mailroom postcard claim flow.
//
//  v0.7.0.25 — initial draft. When a recipient receives a Mailroom claim
//  link (e.g. https://mailroomclub.vercel.app/claim?t=ABC123) and taps it
//  from iMessage / Mail / Safari on iOS 14+, this App Clip launches
//  instead of forcing them through the full App Store install. They
//  enter their mailing address, we redeem the token via the Supabase
//  Edge Function, and the postcard ships.
//
//  Bundle: com.mailrooms.app.Clip
//  Size budget: < 10 MB (Apple's App Clip limit). This bundle is a
//  single SwiftUI screen + a few network calls — well under.
//
//  Setup steps (manual, see APP_CLIPS_SETUP.md):
//   1. Add the App Clip target in Xcode (File → New → Target → App Clip)
//   2. Drop this file + ContentView.swift into the new target's folder
//   3. Add Associated Domains entitlement: applinks:mailroomclub.vercel.app
//   4. Register the bundle id in developer.apple.com
//   5. Configure ASC App Clip experience with URL prefix
//      https://mailroomclub.vercel.app/claim
//   6. Host the AASA file at
//      https://mailroomclub.vercel.app/.well-known/apple-app-site-association
//      (see vercel-staging/apple-app-site-association in this repo for the
//      JSON content, plus vercel-staging/vercel.json for Content-Type)
//

import SwiftUI

@main
struct MailroomClipApp: App {
    // Captures the App Clip invocation URL so ContentView can extract the
    // claim token. Apple passes the URL in via NSUserActivity with
    // type NSUserActivityTypeBrowsingWeb when the user taps the
    // Universal Link.
    @State private var invocationURL: URL?

    var body: some Scene {
        WindowGroup {
            ContentView(invocationURL: invocationURL)
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    invocationURL = activity.webpageURL
                }
        }
    }
}
