---
title: "Houdini HDK ビルドメモ (18.0.460)"
date: "2020-05-24T19:06:39+09:00"
draft: false
url: "/entry/2020/05/24/190639/"
categories: ["Houdini", "C++", "Visual Studio"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2020/05/24/190639"
hatena_basename: "2020/05/24/190639"
math: false
---

<p>HDK(<a class="keyword" href="http://d.hatena.ne.jp/keyword/C%2B%2B">C++</a>)のサンプルについてcmakeでVisualStudioプロジェクトを作成してビルドする機会があったのでメモ.<br />
<b>注意:ビルドが成功してdllが作成されるところまでの確認しかしていない(未実行).</b></p><br />


Houdini 18.0.460  
  
VisualStudio 2017  
  
対象のサンプルは SOP\_Star



<div class="section">
    

### 事前準備


    

Houdiniインストール  
  
VisualStudioインストール  
  
cmake インストール



</div>
<div class="section">
    

### サンプルコードを作業用にコピー


<p>Houdiniインストール<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%C7%A5%A3%A5%EC%A5%AF%A5%C8">ディレクト</a>リのtoolkit<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%C7%A5%A3%A5%EC%A5%AF%A5%C8">ディレクト</a>リを丸ごと適当な<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%C7%A5%A3%A5%EC%A5%AF%A5%C8">ディレクト</a>リにコピー(Documentsなど)</p><p><u>コピー元</u><br />
C:/Program Files/Side Effects Software/Houdini 18.0.460/toolkit</p><p><u>コピー先</u><br />
Documents等</p><p>以降はコピー先<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%C7%A5%A3%A5%EC%A5%AF%A5%C8">ディレクト</a>リで作業する</p>

</div>
<div class="section">
<h3>対象のサンプル<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%C7%A5%A3%A5%EC%A5%AF%A5%C8">ディレクト</a>リへ移動</h3>
<p>初期だと以下のような状態のはず<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/71e22c4f03af5759aaee6fc13b8d66cc5c71144cb65389e9ef130de00fff4f2d.png" alt="f:id:nagakagachi:20200524181238p:plain" title="f:id:nagakagachi:20200524181238p:plain" class="hatena-fotolife" itemprop="image"></span><br />
</p>

</div>
<div class="section">
<h3>VisualStudioプロジェクト作成用<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%C7%A5%A3%A5%EC%A5%AF%A5%C8">ディレクト</a>リ作成</h3>
<p>cmakeで作成するプロジェクトファイル群を入れる<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%C7%A5%A3%A5%EC%A5%AF%A5%C8">ディレクト</a>リを適当な名前で作成(ここではbuildという名前)<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/7a4ddea87d4d59ce6ecae61252fb0777c7ae226446f250e23514dbde6804f64e.png" alt="f:id:nagakagachi:20200524181336p:plain" title="f:id:nagakagachi:20200524181336p:plain" class="hatena-fotolife" itemprop="image"></span><br />
</p>

</div>
<div class="section">
    

### Houdini Command Line Tools 起動


<p>Houdiniの<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%B3%A5%DE%A5%F3%A5%C9%A5%E9%A5%A4%A5%F3">コマンドライン</a>ツールHoudini Command Line Tools(以降Command Line)を起動<figure class="figure-image figure-image-fotolife" title="Houdini Command Line Tools"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/fbc260599f9d90c243dcc795f75a82d2f7903ca5b9c906804c9d1e00e5e0b451.png" alt="f:id:nagakagachi:20200524175758p:plain" title="f:id:nagakagachi:20200524175758p:plain" class="hatena-fotolife" itemprop="image"></span><figcaption>Houdini Command Line Tools</figcaption></figure></p>

</div>
<div class="section">
<h3>プロジェクト作成<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%C7%A5%A3%A5%EC%A5%AF%A5%C8">ディレクト</a>リに移動(Command Line)</h3>
<p>SOP_Star<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%C7%A5%A3%A5%EC%A5%AF%A5%C8">ディレクト</a>リに作成したbuild<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%C7%A5%A3%A5%EC%A5%AF%A5%C8">ディレクト</a>リに移動</p><p>cd /d "作業<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%C7%A5%A3%A5%EC%A5%AF%A5%C8">ディレクト</a>リ"/toolkit/samples/SOP/SOP_Star/build<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/c9468b8dcddfc4610cdae5577404bc4ec017d6e85c2ce6daad0a57699e79ed11.png" alt="f:id:nagakagachi:20200524181857p:plain" title="f:id:nagakagachi:20200524181857p:plain" class="hatena-fotolife" itemprop="image"></span><br />
</p>

</div>
<div class="section">
    

### cmakeコマンドでVisualStudioプロジェクト作成(Command Line)


    

cmakeに -G オプションで作成したいVisualStudioプロジェクトのバージョンを指定して実行する  
  
cmake -help でマシンでサポートされているバージョン一覧が表示されるので参考に  
  
今回はVisualStudio2017の64bitビルドプロジェクトを作りたいので以下のように指定

<p>cmake -G "<a class="keyword" href="http://d.hatena.ne.jp/keyword/Visual%20Studio">Visual Studio</a> 15 2017 <a class="keyword" href="http://d.hatena.ne.jp/keyword/Win64">Win64</a>" ..<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/e1f5685ea303843ddc83b457291141eaf329caf64ca5ef51109b1b322795b087.png" alt="f:id:nagakagachi:20200524182709p:plain" title="f:id:nagakagachi:20200524182709p:plain" class="hatena-fotolife" itemprop="image"></span></p><p>実行すると以下のようなログが流れる<figure class="figure-image figure-image-fotolife" title="cmake実行結果"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/4e1e4ad5822336b0d024b3df06fda591ab88c0f3a5e6e9739d14783fb4005861.png" alt="f:id:nagakagachi:20200524182757p:plain" title="f:id:nagakagachi:20200524182757p:plain" class="hatena-fotolife" itemprop="image"></span><figcaption>cmake実行結果</figcaption></figure></p><p>成功すると実行した<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%C7%A5%A3%A5%EC%A5%AF%A5%C8">ディレクト</a>リ(ここではbuild)に以下のようにVisualStudioソリューションファイルが作成される<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/005e3084ae4a1465568cdc67ddd924586221c33e5b1559cab54ef2921ecc8a29.png" alt="f:id:nagakagachi:20200524183016p:plain" title="f:id:nagakagachi:20200524183016p:plain" class="hatena-fotolife" itemprop="image"></span><br />
</p>

</div>
<div class="section">
    

### VisualStudioで開いてビルド


<p>slnファイル(ここではHDK_Project.sln) をVisualStudio2017 で開いてビルドして完了<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/7f51e7ff5bd3c5710a4bfa1cc44c48a73d65871bcf4d4126276f63a325a297f3.png" alt="f:id:nagakagachi:20200524183215p:plain" title="f:id:nagakagachi:20200524183215p:plain" class="hatena-fotolife" itemprop="image"></span></p>

VisualStudioがビルド後イベント等で  
  
/Documents/houdini18.0/dso/  
  
にdllなどをコピーしてくれる

<p>あとはHoudiniを起動してobjタブでビルドしたSOP_Starを検索すれば可能なはず。<br />
しかし私の環境では出てこなかったので一旦ここまで…(Houdini <a class="keyword" href="http://d.hatena.ne.jp/keyword/Apprentice">Apprentice</a>だからかも)</p>

以上



</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2020/05/24/190639)
