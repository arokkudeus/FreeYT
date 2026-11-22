# YT Lite

m.youtube.com をアプリの中で開き、広告スキップ・バックグラウンド再生・PiP・自動再生・横全画面のスクリプトを自動で動かす、自分のiPhoneで使うためのアプリ。

Sideloadlyでいれてね❤
---

## 1. GitHub でビルドする（Windowsだけでできる！！！！）

1. GitHub で **New repository** を作る
   - 名前は何でもええで
2. リポジトリの画面で **Add file → Upload files** を押し、このフォルダの**中身を全部**ドラッグ＆ドロップして **Commit changes**
   - `.github` フォルダも忘れずに入れてください（ビルドの設定が入っています）
3. 上のタブの **Actions** を開く
   - 「ワークフローを有効にしますか？」と出たら有効にする
   - アップロードしたタイミングで自動でビルドが始まる。始まっていなければ左の **Build IPA** → **Run workflow**
4. 5〜10分ほど待って成功したら、その実行結果を開き、下の **Artifacts** にある **YTLite-ipa** をダウンロード
5. ダウンロードした zip を展開すると **YTLite.ipa** が出てくるお

失敗した失敗した失敗した場合は、その実行結果の赤いステップを開いてエラー文をコピーし、どっかのAIに貼って。おすすめはClaude

## 2. Windows から iPhone に入れる（Sideloadly）
ここに辿り着いてるやつはSideloadlyくらい使えるやろｗ

## 3. iPhone 側の設定
ま、わかるやろｗ

## 4. 7日ごとの入れ直し
これやめたいんやけど、難しい。誰かできる奴いたら教えて。Xのidは@gantobasuzo


---

## 使い方
やってればわかる
頑張ってアプリのほうに寄せてるが。

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
ここらはようわからん
ま、とりあえず楽しんでくれ
フィードバックはTwitterによろ。
