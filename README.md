# Dialogue

A small&mdash;opinionated&mdash;robust&mdash;convenient WebSocket wrapper.

## Features

- Automatic reconnection with exponential backoff
  - Reconnects on error
  - Reconnects based on heartbeat to detect broken pipes
- Parses and validates incoming and outgoing messages to your schema
- Easily subscribe to specific message types with typechecking: `on('chat', (chatMessage) => {})`
- All subscribers return unsubcribers
- `once()`
- Send a "request" message which awaits a response
