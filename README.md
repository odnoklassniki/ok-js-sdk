# ok-js-sdk (JavaScript SDK)

## Usage

Download and pack your app with **oksdk.js**, try one of the provided samples.

## Samples

+ *helloworld* - Simple Hello World, %user% application skeleton
+ *helloworld-norefresh* - Advanced Hello World, proceedes OAUTH authorization via popup window and sending state back via javascript postmessage, so leading to no redirect on the main page
+ *payment* - Open and process a payment
+ *send-simple* - Sending a simple notification to the current user (via non-session method notifications.sendSimple)
+ *viral* - Viral widgets (post media topic; suggest/invite friends to the app)

## Application Requirements

An application registered within OK platform should have:

### Mobile / Web game

1. Target platform checked (like MOBILE_HTML)
2. A VALUABLE_ACCESS permission being checked or requested

### External / OAUTH game (also applicable for native Android/iOS)

1. EXTERNAL platform checked
2. Client OAUTH checkbox checked
3. A VALUABLE_ACCESS permission being checked or requested
