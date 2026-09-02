# おんどくチェック Web App V0.2

家庭の iPhone / iPad / Android / PC のブラウザから利用する音読確認Webアプリです。

## 実装済み
- HTTPS Webアプリ / PWA対応
- MediaRecorderで録音
- Web Audio APIで発声量を端末内判定
- Gemini 3.5 Transcribe (`gemini-3.5-transcribe`) で日本語文字起こし
- 教科書本文をカスタム語彙ヒントとして利用
- 本文との簡易一致判定
- 🟢 / 🟡 / 🔴 判定
- Gemini Files APIに置いた音声は文字起こし後に即DELETE
- Gemini APIキーはCloudflare Worker Secretに置くため児童端末へ露出しない
- 氏名・学校名はAPIへ送らない
- 音声はアプリ側DB/ストレージには保存しない

## 現在の制限
- V0.2では録音全体をGeminiに送信します。ランダム区間切り出しは次段階。
- 先生画面は同一端末のlocalStorageのみ。学級全体の共有一覧は次段階でD1等へ移行。
- 本文登録も現時点では児童画面に直接入力。教師課題配信は次段階。

## Cloudflare Workersへ公開
```bash
npm install
npx wrangler login
npx wrangler secret put GEMINI_API_KEY
npm run deploy
```

## 次に入れる機能
1. 教師が本文と目標時間を登録する課題画面
2. 課題URL/QRコード配布
3. Cloudflare D1に「結果のみ」保存
4. 先生側40人一覧、未実施/要確認だけ抽出
5. 全文送信からランダム区間のみ送信への変更
6. STT provider adapter化（Gemini / Google Cloud Speech / Azure）
