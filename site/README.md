# サイトの編集用ソース

Hugoの標準構成とleaf page bundle方式を採用しています。
参考: https://gohugo.io/content-management/page-bundles/

```text
site/
  hugo.toml
  content/
    posts/
      2026-09-25-195105/
        index.md
        images/
    drafts/
      YYYY-MM-DD-HHMMSS/
        index.md
        images/
```

1記事の本文・メタデータ・画像を同じフォルダで管理します。移行した公開記事は53件、下書きは3件です。下書きはフォルダだけでなくfront matterの`draft: true`でも識別します。通常の公開ビルドでは下書きを含めない方針です。

## 記事の編集

- `index.md`はUTF-8 BOM付き、CRLFです。YAML front matterにタイトル、日時、カテゴリ、公開状態、元記事URL等を保持しています。
- 通常の文章・見出し・一部のコードブロックはMarkdownへ変換済みです。複雑なHTML、画像属性、キャプション、リンク、埋め込みは保持しています。HTMLとMarkdownの混在は移行時の情報保全のためです。
- 保存済み画像は`images/`への相対参照です。異なる記事で共有していた画像は各記事に複製しています。編集用の正式な画像資料であり、一時ファイルではありません。
- 数式画像はMathJax互換のTeX区切りを含む`span.math-inline`へ変換しました。TeXはHTML用のエスケープを施しています。数式を含む記事でのみMathJax 3.2.2をCDNから読み込み、SVGとして描画します。
- 本文末尾の「元のはてなブログ記事」リンクと`hatena_original_url`で移行元を参照できます。
- `url`は`/entry/YYYY/MM/DD/HHMMSS/`とし、元記事のパスとの対応を保持しています。記事フォルダ名はURLと独立しています。
- Google Chartの数式を使った旧アイキャッチ1件は404のため、新しい`image`には指定せず、`hatena_original_image`として記録しています。

## 原本と変換記録

原本はリポジトリ直下の`hatena_backup/`です。このディレクトリはローカル保管用としてGitの対象から除外しています。エクスポート原本、抽出画像、本文・コメントを含む棚卸しJSON、移行記録はGitHubへ送信しません。公開記事に必要な画像は`content/posts/`の記事フォルダ内に保存済みです。バックアップを他の環境へ移す場合はGitとは別に保管・転送してください。`inventory.json`に元の全メタデータと本文セクション、`migration-results.json`に記事・画像の対応、数式、分離記事のハッシュを保存しています。サイト用画像と元画像のSHA-256一致を検証しました。

変換スクリプトは`tools/migrate_hatena.py`です。追加パッケージは不要です。

```powershell
python tools/migrate_hatena.py
```

既存の記事フォルダがある場合は上書きを拒否します。移行後の手編集を保護するため、通常の記事更新は`index.md`を直接編集します。変換を検証する場合は、OS一時ディレクトリ等を`--site`に指定してください。変換結果JSONはアーカイブ側に保存されるため、検証用アーカイブのコピーも`--archive`で指定してください。

## ローカルプレビューと公開

Hugo 0.167.0でビルド検証済みです。記事一覧、カテゴリ、ページ送り、RSS、前後の記事へのリンク、404ページ、数式表示、コードの色分け、スマートフォン表示を実装しています。テンプレートは`layouts/`、CSSと数式設定は`static/`です。

HugoをPATH上に用意した後、リポジトリ直下で実行します。

```powershell
./tools/preview_site.ps1
```

`http://localhost:1313/`で確認できます。手元での編集がプレビューに反映されます。終了はCtrl+Cです。下書きも確認する場合は`-IncludeDrafts`を指定します。下書き一覧自体は生成しないため、記事のfront matterにあるURLを直接開きます。

今回の確認に使った実行ファイルは公式リリースからOS一時ディレクトリへ取得し、公式のSHA-256と照合しました。グローバルなインストールやPATH変更はしていません。

```powershell
./tools/preview_site.ps1 -HugoExecutable "$env:TEMP/nagakagachi-hugo/v0.167.0/hugo.exe"
```

公式リリース: https://github.com/gohugoio/hugo/releases/tag/v0.167.0

ビルドと検証の例（出力はOS一時ディレクトリ）:

```powershell
hugo --source site --destination "$env:TEMP/nagakagachi-site-preview" --cacheDir "$env:TEMP/nagakagachi-hugo-cache" --noBuildLock --minify --panicOnWarning
python tools/validate_site.py "$env:TEMP/nagakagachi-site-preview"
```

`validate_site.py`は公開記事の存在、下書きの除外、ローカルリンク・画像・見出しアンカー、元記事へのリンク、バックアップ等の非混入を検査します。外部サイトや動画サービスの稼働状態は検査対象外です。

`.github/workflows/pages.yml`で、PR時はビルド・検証、mainへのpush時はビルド・検証・公開を行います。Hugoのバージョンを固定し、取得時にチェックサムを確認します。Actionsの構文はactionlintで検査済みですが、GitHub上での実行は未確認です。

公開開始時はリポジトリのSettings → Pages → SourceをGitHub Actionsに設定してから、変更をcommit/pushします。公式説明: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

ビルド出力やキャッシュは`.gitignore`で個別に除外しています。

公開元はこの`site/`に限定し、生成された公開用HTMLだけをPagesへ配置します。バックアップ・移行記録・スクリプトはPagesの公開物に含めません。下書きはGitHub Pagesでの非公開とGitリポジトリでの非公開が別なので、`content/drafts/`の記事本文・画像もGitの対象から除外しています。下書きセクションの公開抑止設定を持つ`_index.md`だけはGitで管理します。下書きを公開する際は記事フォルダを`content/posts/`へ移し、`draft`を`false`にしてから確認してください。

## 表現の方針

サイト独自のキャッチコピーや標語は追加しません。サイトの見出し・タイトルに句点（。）を使わず、サイト名や記事一覧など内容を示す名称を使います。記事本文と移行元の記事タイトルは元の表現を尊重します。

## サイト名と構成

サイト名は「ながむしメモ」です。トップにブログと実験室の入口を設け、ブログはcontent/posts、実験室はcontent/labで管理します。はてなブログからの移行記事はhatena_original_urlを基に一覧と記事ヘッダーへ移行表示を付け、元記事へリンクします。新規記事ではこの移行元フィールドを付けません。

## 配色と記事タイトル一覧

暗い配色を標準にしています。記事タイトル一覧はcontent/contents、実験室はcontent/labです。記事タイトル一覧は全公開ブログ記事を1ページに並べ、タイトルの部分一致検索を行います。大文字小文字と全角半角を区別しません。JavaScriptが無効でも全タイトルとリンクが表示され、ブラウザ内検索で探せます。ヘッダーにはX（https://x.com/nagakagachi）とGitHubへのリンクを配置しています。


## シンボル画像の再生成

原本は`site/static/images/symbol.svg`です。形・線・色はこのSVGを編集し、派生画像を個別に手修正しません。`tools/generate_site_icons.py`が原本をSVGレンダラーで読み込み、favicon.svg、favicon.ico（16/32/48px）、apple-touch-icon.png（180px）、images/profile-icon.png（1024×1024px、文字なし・丸い切り抜き用の余白付き）、images/profile-header.png（1500×500px、文字なし・シンボルは右寄り）、images/site-card.png（1200×630px）をまとめて生成します。小型アイコンの背景・配置とOGP画像の文字配置はスクリプトで管理し、サイト名・説明はhugo.tomlから読み込みます。

このツールだけPython 3.11以上、Pillow、resvg_pyが必要です。移行・サイト検証ツールには追加依存はありません。Windowsでは游ゴシックのフォントファイルを使用します。他の環境では`--font`と`--bold-font`で日本語フォントの実体パスを指定してください。フォントがない場合は生成を中止し、別フォントへ自動代替しません。

初回準備の例（仮想環境はリポジトリ外）:

```powershell
python -m venv "$env:TEMP/nagamushi-icons-venv"
& "$env:TEMP/nagamushi-icons-venv/Scripts/python.exe" -m pip install -r tools/requirements-icons.txt
```

SVG変更後、リポジトリ直下で実行します。

```powershell
& "$env:TEMP/nagamushi-icons-venv/Scripts/python.exe" tools/generate_site_icons.py
```

生成画像の見た目を確認し、原本SVGと派生画像を一緒にコミットします。再生成の確認には`--output-dir`でOS一時ディレクトリを指定できます。Actionsでは再生成せず、コミット済み画像をそのまま公開します。
