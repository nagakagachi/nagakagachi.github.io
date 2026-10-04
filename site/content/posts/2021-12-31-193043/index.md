---
title: " TextureSampleGradのCustomNode"
date: "2021-12-31T19:30:43+09:00"
draft: false
url: "/entry/2021/12/31/193043/"
categories: ["UE4", "UE4", "Graphics", "HLSL", "Material", "UE4", "UE5", "シェーダ", "マテリアル"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2021/12/31/193043"
hatena_basename: "2021/12/31/193043"
math: false
image: "images/2e3423d49d6483a9c5d2b66d4970c02ffe9d900ccf2d17fd49f8834aaa349200.png"
---

UEのマテリアルでTextureからSampleGradでサンプリングするメモ.



これが2021年最後の記事. 良いお年を!


<ul class="table-of-contents">
<li><a href="#CustomNodeの内容">CustomNodeの内容</a></li>
<li><a href="#CustomNodeコピペ用">CustomNodeコピペ用</a></li>
<li><a href="#利用例">利用例</a></li>
<li><a href="#何に使うの">何に使うの</a></li>
</ul>

ノードとしてSampleGradが提供されていないようなので、CustomNodeでSampleGrad関数を直接呼ぶこととする.  
  
(提供されているようならこの記事は見なかったことにしてください.)



<div class="section">
    

<h3 id="CustomNodeの内容">CustomNodeの内容</h3>


<p>TextureとUV, <a class="keyword" href="http://d.hatena.ne.jp/keyword/ddx">ddx</a>, ddy を引数にとって内部で TextureSampleGrad関数を利用する.</p>
<pre class="code lang-cpp" data-lang="cpp" data-unlink><span class="synComment">/*</span>
<span class="synComment">    Input</span>
<span class="synComment">            InTexture  ( and InTextureSampler)</span>
<span class="synComment">            InUv</span>
<span class="synComment">            InDdx</span>
<span class="synComment">            InDdy</span>
<span class="synComment">    </span>
<span class="synComment">    Output</span>
<span class="synComment">            float4</span>
<span class="synComment">*/</span>

float4 tex = <span class="synIdentifier">Texture2DSampleGrad</span>(InTexture, InTextureSampler, InUv, InDdx, InDdy);
<span class="synStatement">return</span> tex;
</pre>
</div>
<div class="section">
    

<h3 id="CustomNodeコピペ用">CustomNodeコピペ用</h3>


    

コピペで利用したい場合は以下のテキストをマテリアルエディタに貼り付ければCustomNodeが生成される.


<pre class="code lang-cpp" data-lang="cpp" data-unlink>
Begin Object Class=/Script/UnrealEd.MaterialGraphNode Name=<span class="synConstant">&quot;MaterialGraphNode_21&quot;</span>
   Begin Object Class=/Script/Engine.MaterialExpressionCustom Name=<span class="synConstant">&quot;MaterialExpressionCustom_2&quot;</span>
   End Object
   Begin Object Name=<span class="synConstant">&quot;MaterialExpressionCustom_2&quot;</span>
      Code=<span class="synConstant">&quot;</span><span class="synSpecial">\r\n</span><span class="synConstant">/*</span><span class="synSpecial">\r\n</span><span class="synConstant">    Input</span><span class="synSpecial">\r\n</span><span class="synConstant">            InTexture  ( and InTextureSampler)</span><span class="synSpecial">\r\n</span><span class="synConstant">            InUv</span><span class="synSpecial">\r\n</span><span class="synConstant">            InDdx</span><span class="synSpecial">\r\n</span><span class="synConstant">            InDdy</span><span class="synSpecial">\r\n</span><span class="synConstant">    </span><span class="synSpecial">\r\n</span><span class="synConstant">    Output</span><span class="synSpecial">\r\n</span><span class="synConstant">            float4</span><span class="synSpecial">\r\n</span><span class="synConstant">*/</span><span class="synSpecial">\r\n\r\n</span><span class="synConstant">float4 tex = Texture2DSampleGrad(InTexture, InTextureSampler, InUv, InDdx, InDdy);</span><span class="synSpecial">\r\n</span><span class="synConstant">return tex;</span><span class="synSpecial">\r\n\r\n</span><span class="synConstant">&quot;</span>
      OutputType=CMOT_Float4
      <span class="synIdentifier">Inputs</span>(<span class="synConstant">0</span>)=(InputName=<span class="synConstant">&quot;InTexture&quot;</span>,Input=(Expression=MaterialExpressionTextureObjectParameter'<span class="synConstant">&quot;MaterialExpressionTextureObjectParameter_1&quot;</span>'))
      <span class="synIdentifier">Inputs</span>(<span class="synConstant">1</span>)=(InputName=<span class="synConstant">&quot;InUv&quot;</span>,Input=(Expression=MaterialExpressionReroute'<span class="synConstant">&quot;MaterialExpressionReroute_0&quot;</span>'))
      <span class="synIdentifier">Inputs</span>(<span class="synConstant">2</span>)=(InputName=<span class="synConstant">&quot;InDdx&quot;</span>,Input=(Expression=MaterialExpressionDDX'<span class="synConstant">&quot;MaterialExpressionDDX_0&quot;</span>'))
      <span class="synIdentifier">Inputs</span>(<span class="synConstant">3</span>)=(InputName=<span class="synConstant">&quot;InDdy&quot;</span>,Input=(Expression=MaterialExpressionDDY'<span class="synConstant">&quot;MaterialExpressionDDY_0&quot;</span>'))
      MaterialExpressionEditorX=-<span class="synConstant">352</span>
      MaterialExpressionEditorY=<span class="synConstant">240</span>
      MaterialExpressionGuid=A6C202464ABAD8F6E9734E9B54C6742D
      Material=PreviewMaterial'<span class="synConstant">&quot;/Engine/Transient.M_TexturePreview&quot;</span>'
   End Object
   MaterialExpression=MaterialExpressionCustom'<span class="synConstant">&quot;MaterialExpressionCustom_2&quot;</span>'
   NodePosX=-<span class="synConstant">352</span>
   NodePosY=<span class="synConstant">240</span>
   ErrorType=<span class="synConstant">1</span>
   ErrorMsg=<span class="synConstant">&quot;Custom material Custom missing input 1 (InTexture)&quot;</span>
   NodeGuid=98660A2E479B2DED7843C29DD7E144AB
   CustomProperties <span class="synIdentifier">Pin </span>(PinId=<span class="synConstant">3F</span>B004F94791B89E090EB9B99B713C0F,PinName=<span class="synConstant">&quot;InTexture&quot;</span>,PinType.PinCategory=<span class="synConstant">&quot;required&quot;</span>,PinType.PinSubCategory=<span class="synConstant">&quot;&quot;</span>,PinType.PinSubCategoryObject=None,PinType.PinSubCategoryMemberReference=(),PinType.PinValueType=(),PinType.ContainerType=None,PinType.bIsReference=False,PinType.bIsConst=False,PinType.bIsWeakPointer=False,PinType.bIsUObjectWrapper=False,LinkedTo=(MaterialGraphNode_83 FF18694A45E6BEAA46EA3F8C083A2CBC,),PersistentGuid=<span class="synPreProc">0</span><span class="synConstant">0000000000000000000000000000000</span>,bHidden=False,bNotConnectable=False,bDefaultValueIsReadOnly=False,bDefaultValueIsIgnored=False,bAdvancedView=False,bOrphanedPin=False,)
   CustomProperties <span class="synIdentifier">Pin </span>(PinId=3E114E314D9BAB61118B329013A0C05A,PinName=<span class="synConstant">&quot;InUv&quot;</span>,PinType.PinCategory=<span class="synConstant">&quot;required&quot;</span>,PinType.PinSubCategory=<span class="synConstant">&quot;&quot;</span>,PinType.PinSubCategoryObject=None,PinType.PinSubCategoryMemberReference=(),PinType.PinValueType=(),PinType.ContainerType=None,PinType.bIsReference=False,PinType.bIsConst=False,PinType.bIsWeakPointer=False,PinType.bIsUObjectWrapper=False,LinkedTo=(MaterialGraphNode_Knot_7 <span class="synConstant">18F</span>E939F4A97C00C67CC16A085BED853,),PersistentGuid=<span class="synPreProc">0</span><span class="synConstant">0000000000000000000000000000000</span>,bHidden=False,bNotConnectable=False,bDefaultValueIsReadOnly=False,bDefaultValueIsIgnored=False,bAdvancedView=False,bOrphanedPin=False,)
   CustomProperties <span class="synIdentifier">Pin </span>(PinId=B5C056784D5BAD800E83398A08AD56B8,PinName=<span class="synConstant">&quot;InDdx&quot;</span>,PinType.PinCategory=<span class="synConstant">&quot;required&quot;</span>,PinType.PinSubCategory=<span class="synConstant">&quot;&quot;</span>,PinType.PinSubCategoryObject=None,PinType.PinSubCategoryMemberReference=(),PinType.PinValueType=(),PinType.ContainerType=None,PinType.bIsReference=False,PinType.bIsConst=False,PinType.bIsWeakPointer=False,PinType.bIsUObjectWrapper=False,LinkedTo=(MaterialGraphNode_85 80EC1CDF4B3A1C9667D72EB37399E8C0,),PersistentGuid=<span class="synPreProc">0</span><span class="synConstant">0000000000000000000000000000000</span>,bHidden=False,bNotConnectable=False,bDefaultValueIsReadOnly=False,bDefaultValueIsIgnored=False,bAdvancedView=False,bOrphanedPin=False,)
   CustomProperties <span class="synIdentifier">Pin </span>(PinId=905889CC49E11D9C88DB2792EF254574,PinName=<span class="synConstant">&quot;InDdy&quot;</span>,PinType.PinCategory=<span class="synConstant">&quot;required&quot;</span>,PinType.PinSubCategory=<span class="synConstant">&quot;&quot;</span>,PinType.PinSubCategoryObject=None,PinType.PinSubCategoryMemberReference=(),PinType.PinValueType=(),PinType.ContainerType=None,PinType.bIsReference=False,PinType.bIsConst=False,PinType.bIsWeakPointer=False,PinType.bIsUObjectWrapper=False,LinkedTo=(MaterialGraphNode_86 BBAD4B0443CF6057D92E17A5A0BB730A,),PersistentGuid=<span class="synPreProc">0</span><span class="synConstant">0000000000000000000000000000000</span>,bHidden=False,bNotConnectable=False,bDefaultValueIsReadOnly=False,bDefaultValueIsIgnored=False,bAdvancedView=False,bOrphanedPin=False,)
   CustomProperties <span class="synIdentifier">Pin </span>(PinId=8EFEA7514110CC30D32E41B0B1689991,PinName=<span class="synConstant">&quot;Output&quot;</span>,PinFriendlyName=<span class="synIdentifier">NSLOCTEXT</span>(<span class="synConstant">&quot;MaterialGraphNode&quot;</span>, <span class="synConstant">&quot;Space&quot;</span>, <span class="synConstant">&quot; &quot;</span>),Direction=<span class="synConstant">&quot;EGPD_Output&quot;</span>,PinType.PinCategory=<span class="synConstant">&quot;&quot;</span>,PinType.PinSubCategory=<span class="synConstant">&quot;&quot;</span>,PinType.PinSubCategoryObject=None,PinType.PinSubCategoryMemberReference=(),PinType.PinValueType=(),PinType.ContainerType=None,PinType.bIsReference=False,PinType.bIsConst=False,PinType.bIsWeakPointer=False,PinType.bIsUObjectWrapper=False,LinkedTo=(MaterialGraphNode_Root_0 1653EE4D4D08EED8A95A3CA74981CFA2,),PersistentGuid=<span class="synPreProc">0</span><span class="synConstant">0000000000000000000000000000000</span>,bHidden=False,bNotConnectable=False,bDefaultValueIsReadOnly=False,bDefaultValueIsIgnored=False,bAdvancedView=False,bOrphanedPin=False,)
End Object
</pre>
</div>
<div class="section">
    

<h3 id="利用例">利用例</h3>


<p>TextureObjectとUV, <a class="keyword" href="http://d.hatena.ne.jp/keyword/ddx">ddx</a>, ddy をCustomNodeに入力する.</p>
<figure class="figure-image figure-image-fotolife" title="当記事のCustomNodeの利用例"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/2e3423d49d6483a9c5d2b66d4970c02ffe9d900ccf2d17fd49f8834aaa349200.png" alt="f:id:nagakagachi:20211231190816p:plain" width="1181" height="819" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>当記事のCustomNodeの利用例</figcaption></figure>
</div>
<div class="section">
    

<h3 id="何に使うの">何に使うの</h3>


<p>確率的テクスチャブレンディング等ではタイリング境界でUVギャップが大きくなり, 自動的なMipLevel選択では<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%A2%A1%BC%A5%C6%A5%A3%A5%D5%A5%A1%A5%AF%A5%C8">アーティファクト</a>が発生してしまう.<br />
そのため自前で適切な勾配(Grad)を計算して明示的に指定する必要がある.</p><p>左画像は通常のTextureSampleノードを使った場合, 右がTextureSampleGradを利用した場合.<br />
TextureSampleではライン上の<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%A2%A1%BC%A5%C6%A5%A3%A5%D5%A5%A1%A5%AF%A5%C8">アーティファクト</a>が発生しているが, TextureSampleGradでは自前で勾配を指定することで改善している.</p>
<figure class="figure-image figure-image-fotolife" title="TextureSampleとTextureSampleGrad"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/0215632df7befd4b1e46c7f514724f119d39c90af56088994fbc0797dba213ab.png" alt="f:id:nagakagachi:20211231192444p:plain" width="1200" height="742" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>TextureSampleとTextureSampleGrad</figcaption></figure>
</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2021/12/31/193043)
