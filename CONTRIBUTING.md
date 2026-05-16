# Contributing

## Development

```bat
dev.cmd
```

## Checks

Run these before opening a pull request:

```bash
npm run lint
npm run build
```

For Tauri/Rust changes, also run:

```bash
cargo fmt --check
cargo check
```

## Privacy Rules

- Do not commit API keys, transcripts, audio files, or local app data.
- Do not paste real keys into screenshots, issues, or logs.
- Keep examples using placeholders such as `DASHSCOPE_API_KEY=`.
- Prefer local-only settings and document any data sent to external services.
