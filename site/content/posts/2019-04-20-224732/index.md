---
title: "UE4 C++プラグインでPostProcess検証"
date: "2019-04-20T22:47:32+09:00"
draft: false
url: "/entry/2019/04/20/224732/"
categories: []
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2019/04/20/224732"
hatena_basename: "2019/04/20/224732"
math: false
image: "images/2c3a48a97669357bebd69593745c15af8efa29a83965365cda37c775a0eb9dfd.png"
---

<p>エンジン改造をせずに<a class="keyword" href="http://d.hatena.ne.jp/keyword/C%2B%2B">C++</a><a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%D7%A5%E9%A5%B0%A5%A4%A5%F3">プラグイン</a>とGlobalShaderでPostProcess的なことをできないか調べてみた。<br><br />
結論としては</p>

<ul>
<li><a class="keyword" href="http://d.hatena.ne.jp/keyword/UE4">UE4</a>は動的解像度関係で複雑なUV計算などを隠蔽しているのでそのあたりを再現しないと正常に動かない</li>
<li>UI描画と同じフル解像度に対して処理するので動的解像度の恩恵を受けられない</li>
</ul>

まぁ、ダメでしたね。



<div class="section">
    

#### 概要


    

基本的にゲームスレッドからの描画命令は ENQUEUE\_RENDER\_COMMANDマクロによってキューに積み込んで描画スレッドが処理する。  
  
描画スレッドはキューに積まれた順番に処理をしていく。  
  
ActorのTickで積み込むとScene描画(ベースパスやPostProcess)の前に積み込まれるので、PostProcessでよく使うSceneColorテクスチャなどがまだ出来上がっていない。  
  
ActorにはUI描画の直前(PostProcess後)のタイミングでコールされる関数を設定できるのでそれを利用すればいい感じのタイミングに描画コマンドを差し込めるのでは？



</div>
<div class="section">
    

#### 結果


    

というわけでActorのPostRenderFor()を利用して描画コマンドを積んでみたところをRenderDocで確認してみた。

<p><span itemscope itemtype="http://schema.org/Photograph"><img src="images/2c3a48a97669357bebd69593745c15af8efa29a83965365cda37c775a0eb9dfd.png" alt="f:id:nagakagachi:20190420212602p:plain" title="f:id:nagakagachi:20190420212602p:plain" class="hatena-fotolife" itemprop="image"></span></p>

一応いい感じの場所で自前の描画コマンドが実行されていることが確認できる。



ただし以下の実行結果のようにSceneColorの領域とRendetTargetのViewportのマッチング計算がうまくいっていなかったりしていろいろ問題がある。  
  
(ウィンドウサイズを変更すると描画領域が変わっておかしくなる)

<p><iframe allowfullscreen="" src="//www.youtube.com/embed/9i00cuWclkc" width="560" height="315" frameborder="0"></iframe><br><a href="https://youtube.com/watch?v=9i00cuWclkc">UE4 C++プラグインでPostProcess検証</a></p><p><a class="keyword" href="http://d.hatena.ne.jp/keyword/UE4">UE4</a>側でToneMap後にHookできるようになったり描画領域に応じたUV補正計算の自動化がサポートされないだろうか…</p>

</div>
<div class="section">
    

#### 関連コード


    
<div class="section">
    

##### シェーダ


    <pre class="code lang-cpp" data-lang="cpp" data-unlink><span class="synPreProc">#include </span><span class="synConstant">&quot;/Engine/Public/Platform.ush&quot;</span>

Texture2D       SceneColor;
SamplerState    SceneColorSampler;

<span class="synComment">// フルスクリーンVS</span>
<span class="synType">void</span> MainVS(
    in uint GlobalVertexId : SV_VertexID,
    out float2 OutUV : TEXCOORD0,
    out float4 OutPosition : SV_POSITION
    )
{
    uint VertexId = GlobalVertexId;
    
    float2 CellVertexUV = float2(<span class="synConstant">0x1</span> &amp; ((VertexId + <span class="synConstant">1</span>) / <span class="synConstant">3</span>), VertexId &amp; <span class="synConstant">0x1</span>);

    <span class="synComment">// Output vertex position.</span>
    OutPosition = float4(CellVertexUV * <span class="synConstant">2</span> - <span class="synConstant">1</span>, <span class="synConstant">0</span>, <span class="synConstant">1</span>);

    <span class="synComment">// Output top left originated UV of the vertex.</span>
    OutUV = float2(CellVertexUV.x, <span class="synConstant">1</span> - CellVertexUV.y);
}


<span class="synComment">// フレームバッファ使用PS</span>
<span class="synType">void</span> MainPS(
    in noperspective float2 UV : TEXCOORD0,
    in float4 SvPosition : SV_POSITION,
    out float4 OutColor : SV_Target0
    )
{
    float4 c = SceneColor.SampleLevel(SceneColorSampler, UV, <span class="synConstant">0</span>);

    OutColor = float4(c.x, UV.x, UV.y, <span class="synConstant">1</span>);
}
</pre>
</div>
<div class="section">
    

##### Actor(.h)


    <pre class="code lang-cpp" data-lang="cpp" data-unlink>UCLASS()
<span class="synType">class</span> ANglSampleRenderSystem : <span class="synStatement">public</span> AActor
{
	GENERATED_BODY()

<span class="synStatement">public</span>:
	<span class="synType">void</span> BeginPlay();

	<span class="synType">static</span> <span class="synType">void</span> RenderPostProcess(FRHICommandList&amp; RHICmdList, ERHIFeatureLevel::Type FeatureLevel, <span class="synType">const</span> FRenderTarget* viewRenderTarget);

	<span class="synType">void</span> PostRenderFor(<span class="synType">class</span> APlayerController* PC, <span class="synType">class</span> UCanvas* Canvas, FVector CameraPosition, FVector CameraDir);

<span class="synStatement">private</span>:
};
</pre>
</div>
<div class="section">
    

##### Acotr(.cpp)


    <pre class="code lang-cpp" data-lang="cpp" data-unlink>
<span class="synType">class</span> FSamplePostprocessShader : <span class="synStatement">public</span> FGlobalShader
{
<span class="synStatement">public</span>:
	<span class="synType">static</span> <span class="synType">bool</span> ShouldCache(EShaderPlatform Platform)
	{
		<span class="synStatement">return</span> IsFeatureLevelSupported(Platform, ERHIFeatureLevel::SM4);
	}

	<span class="synType">static</span> <span class="synType">void</span> ModifyCompilationEnvironment(<span class="synType">const</span> FGlobalShaderPermutationParameters&amp; Parameters, FShaderCompilerEnvironment&amp; OutEnvironment)
	{
		FGlobalShader::ModifyCompilationEnvironment(Parameters, OutEnvironment);
	}

	<span class="synType">static</span> <span class="synType">bool</span> ShouldCompilePermutation(<span class="synType">const</span> FGlobalShaderPermutationParameters&amp; Parameters)
	{
		<span class="synComment">// Useful when adding a permutation of a particular shader</span>
		<span class="synStatement">return</span> <span class="synConstant">true</span>;
	}

	FSamplePostprocessShader() {}

	<span class="synComment">// シェーダパラメータと変数をバインド</span>
	FSamplePostprocessShader(<span class="synType">const</span> ShaderMetaType::CompiledShaderInitializerType&amp; Initializer)
		:FGlobalShader(Initializer)
	{
		<span class="synComment">// シェーダパラメータと変数をバインド</span>
		SceneColor_.Bind(Initializer.ParameterMap, TEXT(<span class="synConstant">&quot;SceneColor&quot;</span>));
		SceneColorSampler_.Bind(Initializer.ParameterMap, TEXT(<span class="synConstant">&quot;SceneColorSampler&quot;</span>));
	}
	<span class="synComment">// シリアライズメソッド</span>
	<span class="synType">virtual</span> <span class="synType">bool</span> Serialize(FArchive&amp; Ar) <span class="synType">override</span>
	{
		<span class="synComment">// シェーダパラメータ変数のシリアライズ</span>
		<span class="synType">bool</span> bShaderHasOutdatedParameters = FGlobalShader::Serialize(Ar);
		Ar &lt;&lt; SceneColor_ &lt;&lt; SceneColorSampler_;
		<span class="synStatement">return</span> bShaderHasOutdatedParameters;
	}

	<span class="synComment">// シェーダパラメータ設定をする固有メソッド</span>
	<span class="synType">template</span>&lt;<span class="synType">typename</span> TShaderRHIParamRef&gt;
	<span class="synType">void</span> SetParameters(
		FRHICommandList&amp; RHICmdList,
		<span class="synType">const</span> TShaderRHIParamRef ShaderRHI,
		FTextureRHIParamRef inTexture
	)
	{
		<span class="synComment">//SetTextureParameter(RHICmdList, ShaderRHI, SceneColor_, inTexture);</span>
		SetTextureParameter( RHICmdList, ShaderRHI, 
			SceneColor_, SceneColorSampler_, 
			TStaticSamplerState&lt;SF_Bilinear, AM_Clamp, AM_Clamp, AM_Clamp&gt;::GetRHI(), inTexture);
	}
<span class="synStatement">private</span>:
	<span class="synComment">// シェーダパラメータ変数群</span>
	FShaderResourceParameter SceneColor_;
	FShaderResourceParameter SceneColorSampler_;
};

<span class="synType">class</span> FSamplePostprocessShaderVS : <span class="synStatement">public</span> FSamplePostprocessShader
{
	DECLARE_SHADER_TYPE(FSamplePostprocessShaderVS, Global);

<span class="synStatement">public</span>:
	<span class="synComment">/** Default constructor. */</span>
	FSamplePostprocessShaderVS() {}

	<span class="synComment">/** Initialization constructor. */</span>
	FSamplePostprocessShaderVS(<span class="synType">const</span> ShaderMetaType::CompiledShaderInitializerType&amp; Initializer)
		:FSamplePostprocessShader(Initializer)
	{
	}
};

<span class="synType">class</span> FSamplePostprocessShaderPS : <span class="synStatement">public</span> FSamplePostprocessShader
{
	DECLARE_SHADER_TYPE(FSamplePostprocessShaderPS, Global);

<span class="synStatement">public</span>:

	<span class="synComment">/** Default constructor. */</span>
	FSamplePostprocessShaderPS() {}

	<span class="synComment">/** Initialization constructor. */</span>
	FSamplePostprocessShaderPS(<span class="synType">const</span> ShaderMetaType::CompiledShaderInitializerType&amp; Initializer)
		:FSamplePostprocessShader(Initializer)
	{ }
};

<span class="synComment">// シェーダコードとGlobalShaderクラスを関連付け</span>
IMPLEMENT_SHADER_TYPE(, FSamplePostprocessShaderVS, TEXT(<span class="synConstant">&quot;/Plugin/ShaderPlugin/Private/sample_postprocess.usf&quot;</span>), TEXT(<span class="synConstant">&quot;MainVS&quot;</span>), SF_Vertex)
IMPLEMENT_SHADER_TYPE(, FSamplePostprocessShaderPS, TEXT(<span class="synConstant">&quot;/Plugin/ShaderPlugin/Private/sample_postprocess.usf&quot;</span>), TEXT(<span class="synConstant">&quot;MainPS&quot;</span>), SF_Pixel)


<span class="synType">void</span> ANglSampleRenderSystem::BeginPlay()
{
	Super::BeginPlay();
	
	AGameModeBase* Mode = UGameplayStatics::GetGameMode(<span class="synStatement">this</span>);
	APlayerController*PlayerController = UGameplayStatics::GetPlayerController(<span class="synStatement">this</span>, <span class="synConstant">0</span>);
	AHUD* HUD = PlayerController-&gt;GetHUD();
	<span class="synComment">// このActorのPostRenderForをコールバック登録</span>
	HUD-&gt;AddPostRenderedActor(<span class="synStatement">this</span>);
	<span class="synComment">// HUDオーバーレイを有効化</span>
	HUD-&gt;bShowOverlays = <span class="synConstant">true</span>;
	
}

<span class="synType">void</span> ANglSampleRenderSystem::RenderPostProcess(FRHICommandList&amp; RHICmdList, ERHIFeatureLevel::Type FeatureLevel, <span class="synType">const</span> FRenderTarget* viewRenderTarget)
{
	SCOPED_DRAW_EVENTF(RHICmdList, SceneCapture, TEXT(<span class="synConstant">&quot;ANglSampleRenderSystem::RenderTest&quot;</span>));
	
	<span class="synType">auto</span> finalRenderTarget = viewRenderTarget;
	<span class="synStatement">if</span> (!finalRenderTarget)
		<span class="synStatement">return</span>;

	<span class="synType">auto</span> ShaderMap = GetGlobalShaderMap(FeatureLevel);

	TShaderMapRef&lt;FSamplePostprocessShaderVS&gt; vs(ShaderMap);
	TShaderMapRef&lt;FSamplePostprocessShaderPS&gt; ps(ShaderMap);

	<span class="synComment">// PostProcessシステムからバッファを取得</span>
	FSceneRenderTargets&amp; SceneContext = FSceneRenderTargets::Get(RHICmdList);
	<span class="synType">auto</span> sceneColor = SceneContext.GetSceneColorTexture();

	<span class="synType">auto</span> finalRenderTargetSize = finalRenderTarget-&gt;GetSizeXY();

	<span class="synComment">// CanvasのViewFamilyから取得したターゲットへ書き込んでみる</span>
	<span class="synType">auto</span> rt_action = ERenderTargetActions::DontLoad_Store;
	FRHIRenderPassInfo passInfo(finalRenderTarget-&gt;GetRenderTargetTexture(), rt_action, <span class="synConstant">nullptr</span>);
	RHICmdList.BeginRenderPass(passInfo, TEXT(<span class="synConstant">&quot;NglSampleRender&quot;</span>));
	FIntPoint viewportSize(finalRenderTargetSize.X, finalRenderTargetSize.Y);
	<span class="synComment">// ターゲットに対してフルスクリーンビューポート</span>
	RHICmdList.SetViewport(
		<span class="synConstant">0</span>, <span class="synConstant">0</span>, <span class="synConstant">0.f</span>,
		viewportSize.X, viewportSize.Y, <span class="synConstant">1.f</span>);

	<span class="synComment">// PSO</span>
	FGraphicsPipelineStateInitializer GraphicsPSOInit;
	RHICmdList.ApplyCachedRenderTargets(GraphicsPSOInit);
	GraphicsPSOInit.DepthStencilState = TStaticDepthStencilState&lt;<span class="synConstant">false</span>, CF_Always&gt;::GetRHI();
	GraphicsPSOInit.BlendState = TStaticBlendState&lt;&gt;::GetRHI();
	GraphicsPSOInit.RasterizerState = TStaticRasterizerState&lt;&gt;::GetRHI();
	GraphicsPSOInit.PrimitiveType = PT_TriangleList;
	GraphicsPSOInit.BoundShaderState.VertexDeclarationRHI = GetVertexDeclarationFVector4();
	GraphicsPSOInit.BoundShaderState.VertexShaderRHI = GETSAFERHISHADER_VERTEX(*vs);
	GraphicsPSOInit.BoundShaderState.PixelShaderRHI = GETSAFERHISHADER_PIXEL(*ps);
	SetGraphicsPipelineState(RHICmdList, GraphicsPSOInit);


	<span class="synComment">// シェーダパラメータ更新</span>
	vs-&gt;SetParameters(RHICmdList, vs-&gt;GetVertexShader(), <span class="synConstant">nullptr</span>);
	ps-&gt;SetParameters(RHICmdList, ps-&gt;GetPixelShader(), sceneColor.GetReference());<span class="synComment">// SceneColorをシェーダリソース利用</span>

	<span class="synComment">// 矩形描画</span>
	RHICmdList.DrawPrimitive(<span class="synConstant">0</span>, <span class="synConstant">2</span>, <span class="synConstant">1</span>);

	RHICmdList.EndRenderPass();
}

<span class="synType">void</span> ANglSampleRenderSystem::PostRenderFor(<span class="synType">class</span> APlayerController* PC, <span class="synType">class</span> UCanvas* Canvas, FVector CameraPosition, FVector CameraDir)
{
	Super::PostRenderFor(PC, Canvas, CameraPosition, CameraDir);

	ERHIFeatureLevel::Type FeatureLevel = GetWorld()-&gt;Scene-&gt;GetFeatureLevel();

	Canvas-&gt;SizeX;
	Canvas-&gt;SizeY;

	<span class="synType">auto</span> viewRenderTarget = Canvas-&gt;SceneView-&gt;Family-&gt;RenderTarget;

	ENQUEUE_RENDER_COMMAND(CaptureCommand)(
		[<span class="synStatement">this</span>, FeatureLevel, viewRenderTarget](FRHICommandListImmediate&amp; RHICmdList)
		{
			RenderPostProcess(RHICmdList, FeatureLevel, viewRenderTarget);
		}
	);
}
</pre>
</div>
</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2019/04/20/224732)
