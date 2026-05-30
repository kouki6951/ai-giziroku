
議事録支援Webアプリ 設計書（認証なし版）

# 概要
AmiVoice APIを利用してリアルタイム音声認識を行い、自分と相手の発言を表示する。
任意のタイミングでClaude APIへ会話履歴を送信し、追加ヒアリング事項や確認事項を提案する。
議事録・Claude提案内容は保存し、後から閲覧可能とする。

# システム構成

ブラウザ(Next.js)
↓
Next.js Route Handler
├─ AmiVoice API
├─ Claude API
└─ SQLite(PostgreSQLへ変更可能)

# 機能一覧

- ミーティング開始
- リアルタイム音声認識
- 発言者別表示
- Claude提案生成
- 議事録生成
- 保存
- 過去議事録閲覧
- Claude提案履歴閲覧

# DB設計

## meetings

id
title
started_at
ended_at
created_at
updated_at

## transcripts

id
meeting_id
speaker_type
text
created_at

speaker_type:
- self
- partner

## claude_feedbacks

id
meeting_id
feedback_text
created_at

## meeting_summaries

id
meeting_id
summary_text
created_at

# API

POST /api/meetings/start
POST /api/meetings/end

POST /api/transcripts

POST /api/claude/feedback
直近会話から追加ヒアリング事項を生成

POST /api/claude/summary
議事録生成

GET /api/meetings
GET /api/meetings/{id}

# Claude提案

入力:
- 直近N分の会話
- 発言履歴

出力:
- 確認不足事項
- 追加質問候補
- リスク
- 次アクション

# 議事録出力

- 会議概要
- 課題
- 要望
- 決定事項
- TODO
