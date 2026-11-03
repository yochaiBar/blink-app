# Security

What Blinks protects, and what it doesn't. Photos are end-to-end encrypted
between group members; most other data is ordinary server-side data.

## Reporting a vulnerability

Please report privately through GitHub's **Report a vulnerability** (the
repository's Security tab), not in a public issue.

## What is protected

**Photo content.** A photo is encrypted on the sender's phone and decrypted
only on members' phones.

- Each group has a random 256-bit group key, generated on a member's phone
  and kept in the OS keychain / keystore (`expo-secure-store`).
- Photos are sealed with AES-256-GCM under that key, with a fresh random IV
  for every photo. The associated data binds each photo to its group,
  challenge, response, sender and key version
  (`blink/photo/v2|group|challenge|response|sender|key_version`), so the
  server can't pass one photo off as another, or as someone else's.
- The server relays ciphertext in memory and never stores photo bytes. When
  a recipient is offline it keeps only a pickup note — who is owed which
  response — and asks the sender's phone to re-send when both are online.
  Notes are deleted on delivery, or after 7 days.

**Who receives a photo.** The server picks the recipients, not the sending
app. A photo goes only to current members of the group, never to the sender,
and never to anyone blocked with the sender in either direction. Only the
response's author, while still a member, may relay it, and only under the
group's current key version.

**The group key in transit.** A member's phone ("courier") wraps the group
key for one specific device of a joining member:

- Wrapping uses X25519 with an ephemeral key, then HKDF-SHA256, then
  AES-256-GCM, bound to the group, joiner, joiner's device and key version
  (`blink/keyshare/v2|…`). The server routes the envelope but can't open it,
  and it opens only on that device.
- Only a member who holds the current key version is asked to courier, and
  only while both phones are online. The envelope is sent to that one device.
- Leaving a group or deleting your account cancels your pending key
  requests, releases anything you were couriering, and drops your photo
  pickups.
- Only an admin can introduce a new key version, by being its first
  holder: after a reset, only the admin who reset. So another member can't
  slip in a key they made themselves as the group's new key.

**Changed device keys (trust on first use).** Each phone pins every other
member's device public key the first time it sees it. If a member's key
later changes (a reinstall, a new phone, or a server substituting its own
key), the courier refuses to share the group key with it. Group detail then
shows "<name>'s security key changed" until you accept the change.

## What is not protected

- **The first key you see.** Pinning catches a key that _changes_. It can't
  tell whether the first key seen for a member — for example, a member the
  server itself added — really belongs to them. Comparing safety codes in
  person would; that isn't built yet.
- **The group key itself isn't verified.** A joiner can't tell whether the
  key a courier hands it is the group's real key. A malicious current
  member, acting as courier, could give a joiner a fake key. The joiner
  then can't read the group's photos, and photos it sends are readable by
  the faker instead of the group. Verifying group keys is planned.
- **A compromised server** can't read photos. It does control accounts,
  group membership and routing, so it could add a member or device of its
  own and have the key couriered to it (see above). It could also withhold
  or delay messages. Device-key attestation stops other users from claiming
  your key, but not the server.
- **Metadata.** The server knows who is in which group, when challenges
  start, who responded and how fast, photo sizes, and who is owed which
  photo.
- **Non-photo content** is stored server-side in plaintext: names, phone
  numbers, group names, comments, reactions, notifications, blocks and
  reports. Push notifications (for example "Dana commented on your photo")
  pass through Expo and Apple / Google push services.
- **No forward secrecy, and no rotation on leave.** A group uses one key
  until an admin resets it. A member who leaves keeps the key. The server
  stops sending them photos, but anyone holding the key could decrypt
  ciphertext made under it. A reset protects photos sent after it; photos
  already on phones stay readable.
- **Your phone.** Decrypted photos are stored in the app's sandbox. The
  sender keeps their own photo for 7 days to serve pickups; received photos
  are kept until evicted. Anyone with access to an unlocked phone, a
  screenshot, or a device backup can see them.
- **Sign-in** is by SMS one-time code. Codes are stored hashed and
  rate-limited, but SMS can be intercepted or SIM-swapped. A test mode that
  accepts a fixed code exists for development; it must be off in production.

## Where to look

- Wire formats and associated data: `blink-app/shared/photoProtocol.ts`
  (byte-identical to `blink-server/src/shared/photoProtocol.ts`)
- Client crypto: `blink-app/services/groupCrypto.ts`, `photoTransfer.ts`,
  `keyTransfer.ts`, `keyPins.ts`
- Server routing: `blink-server/src/services/relayHub.ts`, `keyshareHub.ts`
