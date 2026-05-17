//
//  MailroomClipApp.swift
//  MailroomClip
//
//  App Clip entry point. Captures the invocation URL from the
//  Universal Link that launched the clip (NSUserActivityTypeBrowsingWeb)
//  and passes it into ContentView so we can extract ?t=TOKEN.
//

import SwiftUI

@main
struct MailroomClipApp: App {
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
