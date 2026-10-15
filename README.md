# YT Lite（自分用 YouTube アプリ）

m.youtube.com をアプリの中で開き、広告スキップ・バックグラウンド再生・PiP・自動再生・横全画面のスクリプトを自動で動かす、自分のiPhoneで使うためのアプリです。

- App Store では配布できません（自分のiPhoneに入れて使う専用）
- 無料のApple IDで入れた場合、**7日ごとに入れ直し**が必要です
- YouTube の仕様変更で一部機能が動かなくなることがあります

---

## 1. GitHub でビルドする（Windowsだけでできます）

1. GitHub で **New repository** を作る
   - 名前は何でもOK（例：`ytlite`）
   - **Public（公開）にするとビルドが無料**です。Private だと無料枠を早く使います
2. リポジトリの画面で **Add file → Upload files** を押し、このフォルダの**中身を全部**ドラッグ＆ドロップして **Commit changes**
   - `.github` フォルダも忘れずに入れてください（ビルドの設定が入っています）
3. 上のタブの **Actions** を開く
   - 「ワークフローを有効にしますか？」と出たら有効にする
   - アップロードしたタイミングで自動でビルドが始まります。始まっていなければ左の **Build IPA** → **Run workflow**
4. 5〜10分ほど待って ✅ になったら、その実行結果を開き、下の **Artifacts** にある **YTLite-ipa** をダウンロード
5. ダウンロードした zip を展開すると **YTLite.ipa** が出てきます

❌ になった場合は、その実行結果の赤いステップを開いてエラー文をコピーし、Claude に貼ってください。

## 2. Windows から iPhone に入れる（Sideloadly）

1. Windows に以下を入れる
   - **iTunes** と **iCloud**：Microsoft Store 版ではなく、**Apple 公式サイトからダウンロードする版**を入れる
   - **Sideloadly**（公式サイト sideloadly.io から）
2. iPhone を USB で PC につなぎ、iPhone に「このコンピュータを信頼しますか？」と出たら **信頼**
3. Sideloadly を開き、`YTLite.ipa` をウィンドウにドラッグ
4. **Apple ID** 欄に自分の Apple ID を入れて **Start**
   - パスワードや2ファクタ認証のコードを聞かれたら入力
   - 気になる人は、普段使いと別のサブの Apple ID を使ってもOKです

## 3. iPhone 側の設定（初回だけ）

1. **設定 → プライバシーとセキュリティ → デベロッパモード** をオン（再起動が求められます）
2. **設定 → 一般 → VPNとデバイス管理** → 自分の Apple ID → **信頼**
3. ホーム画面の **YT Lite** を開く

## 4. 7日ごとの入れ直し

無料の Apple ID だと 7日で起動できなくなります。そのときは **2. の手順をもう一度**やれば、ログイン情報や設定は消えずにそのまま使えます。

AltStore（Windows版あり）を使うと、PCと同じWi-Fiにいるときに自動で更新してくれます。

---

## 使い方

| やりたいこと | 操作 |
|---|---|
| 横全画面 | スマホを横に倒す（回転ロック中は右下のボタン） |
| 全画面をやめる | 縦に戻す、または右上の ✕ |
| iOS標準の全画面 | 全画面ボタンを長押し |
| PiP（小窓） | 右下の PiP ボタン |
| 前のページに戻る | 画面の左端から右にスワイプ |
| 再読み込み | 一番上で下に引っ張る |

アプリ本体は縦向きに固定されているので、回転ロックをオフにしていても動画一覧などは縦のままです。

## スクリプトを更新したいとき

`YTLite/Resources/yt-lite.user.js` を新しいものに差し替えてアップロードすると、自動でビルドし直されます。新しい `.ipa` を 2. の手順で入れ直してください。

## フォルダ構成

```
project.yml                     … Xcodeプロジェクトの設定（ビルド時に自動変換）
.github/workflows/build.yml     … GitHub上のMacでビルドする手順
YTLite/AppDelegate.swift        … アプリの起動処理
YTLite/ViewController.swift     … 画面（WebView・縦固定・横全画面・広告ブロック）
YTLite/Resources/yt-lite.user.js … Safari版と同じスクリプト
YTLite/Assets.xcassets          … アイコン
```
