use crate::scene::Camera;

// 操作パネルは共通設定を編集するだけで、GPUコマンドを発行しない。
impl super::State {
    pub(super) fn inspector(&mut self, ui: &mut egui::Ui) {
        let before = self.modeler;
        ui.horizontal(|ui| {
            ui.selectable_value(&mut self.modeler, false, "Renderer");
            ui.selectable_value(&mut self.modeler, true, "Foliage Modeler");
        });
        if before != self.modeler {
            self.camera = if self.modeler {
                Camera {
                    position: glam::Vec3::new(0., 6., 18.),
                    speed: 10.,
                    ..Default::default()
                }
            } else {
                Camera::default()
            };
            self.settings.freeze = false;
            self.settings.leaf_lod = if self.modeler { 0 } else { -1 };
        }
        if self.modeler {
            ui.horizontal(|ui| {
                for (name, yaw, pitch) in
                    [("正面", 0., 0.), ("斜め", 0.65, 0.5), ("上面", 0., 1.50)]
                {
                    if ui.button(name).clicked() {
                        self.camera.yaw = yaw;
                        self.camera.pitch = pitch;
                        let target = glam::Vec3::new(
                            0.,
                            if self.renderer.cluster_mode == 0 {
                                self.model.height * 0.5
                            } else {
                                0.8
                            },
                            0.,
                        );
                        let radius =
                            if self.renderer.preview_count > 1 && self.renderer.cluster_mode == 0 {
                                (self.renderer.preview_count as f32).sqrt().ceil() * 18.
                            } else {
                                18.
                            };
                        self.camera.position = target - self.camera.forward() * radius;
                    }
                }
            });
            ui.checkbox(&mut self.settings.modeler_silhouette, "シルエット表示");
            ui.collapsing("樹木モデリング", |ui| {
                egui::ComboBox::from_label("プレビュー")
                    .selected_text(
                        ["樹木", "枝葉部品", "枝葉LOD比較"][self.renderer.cluster_mode as usize],
                    )
                    .show_ui(ui, |ui| {
                        for (i, n) in ["樹木", "枝葉部品", "枝葉LOD比較"].iter().enumerate()
                        {
                            ui.selectable_value(&mut self.renderer.cluster_mode, i as u32, *n);
                        }
                    });
                ui.checkbox(&mut self.renderer.skeleton, "骨格中心線");
                if self.renderer.cluster_mode == 2 {
                    ui.label("左からLOD0 / LOD1 / LOD2 / LOD3");
                }

                let old = self.model.form;
                egui::ComboBox::from_label("樹形")
                    .selected_text(["円錐", "卵", "球", "傘", "杯", "しだれ"][self.model.form])
                    .show_ui(ui, |ui| {
                        for (i, n) in ["円錐", "卵", "球", "傘", "杯", "しだれ"]
                            .iter()
                            .enumerate()
                        {
                            ui.selectable_value(&mut self.model.form, i, *n);
                        }
                    });
                if old != self.model.form {
                    self.model.shape = crate::models::preset(self.model.form);
                }
                ui.add(egui::DragValue::new(&mut self.model.seed).prefix("シード "));
                ui.add(egui::Slider::new(&mut self.model.height, 3.0..=20.0).text("樹高"));
                ui.add(egui::Slider::new(&mut self.model.crown, 2.0..=10.0).text("樹冠幅"));
                ui.add(egui::Slider::new(&mut self.model.bend, 0.0..=3.0).text("主幹の曲がり"));
                ui.add(egui::Slider::new(&mut self.model.branches, 0..=3).text("主要枝数"));
                ui.add(egui::Slider::new(&mut self.model.sockets, 4..=48).text("取り付け数"));
                ui.add(
                    egui::Slider::new(&mut self.renderer.preview_count, 1..=100).text("配置本数"),
                );
                ui.add(egui::Slider::new(&mut self.renderer.wood_lod, 0..=2).text("幹LOD"));
                egui::ComboBox::from_label("枝葉規模クラス")
                    .selected_text(["小", "中", "大"][self.model.class])
                    .show_ui(ui, |ui| {
                        for (i, n) in ["小", "中", "大"].iter().enumerate() {
                            ui.selectable_value(&mut self.model.class, i, *n);
                        }
                    });
                egui::ComboBox::from_label("バリエーション")
                    .selected_text(["扇状", "丸い塊", "垂れ枝", "松風"][self.model.variation])
                    .show_ui(ui, |ui| {
                        for (i, n) in ["扇状", "丸い塊", "垂れ枝", "松風"].iter().enumerate()
                        {
                            ui.selectable_value(&mut self.model.variation, i, *n);
                        }
                    });
                ui.add(egui::Slider::new(&mut self.model.spread, 0.4..=1.8).text("枝の広がり"));
                ui.add(egui::Slider::new(&mut self.model.opening, 0.4..=1.6).text("葉の開き"));
                ui.add(egui::Slider::new(&mut self.model.depth, 0.4..=1.8).text("奥行き"));
                ui.add(egui::Slider::new(&mut self.model.leaf_size, 0.4..=1.6).text("葉のサイズ"));
                ui.add(egui::Slider::new(&mut self.model.radius, 0.01..=0.08).text("幹の太さ"));
                ui.add(egui::Slider::new(&mut self.model.taper, 0.5..=2.0).text("幹のテーパー"));
                ui.collapsing("樹形パラメータ", |ui| {
                    for i in 0..20 {
                        let (a, b) = crate::models::SHAPE_RANGES[i];
                        ui.add(
                            egui::Slider::new(&mut self.model.shape[i], a..=b)
                                .text(crate::models::SHAPE_NAMES[i]),
                        );
                    }
                    self.model.shape[2] = self.model.shape[2].max(self.model.shape[1]);
                    self.model.shape[15] = self.model.shape[15].max(self.model.shape[14]);
                });
            });
        }
        ui.heading("RenderingSandbox v05");
        ui.label("Rust / wgpu / egui");
        ui.separator();
        ui.horizontal(|ui| {
            ui.checkbox(&mut self.measure, "GPU計測");
            ui.checkbox(&mut self.continuous, "連続描画");
        });
        if !self.profiler.supported() {
            ui.label("GPU Frame：計測非対応");
        } else if let Some(ms) = self.profiler.milliseconds {
            ui.label(format!("GPU Frame：{ms:.3} ms"));
            ui.small(format!(
                "計測フレーム #{}・平滑値／停止中は最終値",
                self.profiler.frame
            ));
        } else {
            ui.label("GPU Frame：取得中");
        }
        ui.collapsing("GPU計測・比較", |ui| {
            ui.label(format!(
                "直近240サンプル・ウォームアップ残り {}・計測省略 {}",
                self.profiler.warmup_remaining(),
                self.profiler.skipped
            ));
            if ui.button("統計をリセット").clicked() {
                self.profiler.reset();
            }
            egui::ScrollArea::horizontal()
                .id_salt("gpu-time-scroll")
                .show(ui, |ui| {
                    egui::Grid::new("gpu-time-table")
                        .striped(true)
                        .show(ui, |ui| {
                            for title in ["区間", "最新 ms", "中央値", "P95", "件数"] {
                                ui.label(title);
                            }
                            ui.end_row();
                            for (name, window) in &self.profiler.history {
                                if let Some((n, last, median, p95)) = window.summary() {
                                    ui.label(*name);
                                    ui.label(format!("{last:.3}"));
                                    ui.label(format!("{median:.3}"));
                                    ui.label(format!("{p95:.3}"));
                                    ui.label(n.to_string());
                                    ui.end_row();
                                }
                            }
                        });
                });
            ui.small("パスの和とFrame時間は一致しません。設定・解像度変更で統計をリセットします");
            if ui
                .checkbox(&mut self.camera_locked, "比較用にカメラ・太陽を固定")
                .changed()
                && self.camera_locked
            {
                self.settings.animate = false;
                self.settings.freeze = true;
                self.profiler.reset();
            }
            for i in 0..2 {
                ui.horizontal(|ui| {
                    let name = if i == 0 { "A" } else { "B" };
                    if ui.button(format!("{name}を保存")).clicked() {
                        self.comparisons[i] = Some(super::Snapshot {
                            settings: self.settings.clone(),
                            camera: self.camera.clone(),
                            resolution: self.resolution,
                        });
                    }
                    if ui
                        .add_enabled(
                            self.comparisons[i].is_some(),
                            egui::Button::new(format!("{name}を復帰")),
                        )
                        .clicked()
                    {
                        let value = self.comparisons[i].as_ref().unwrap();
                        self.settings = value.settings.clone();
                        self.camera = value.camera.clone();
                        self.resolution = value.resolution;
                        self.renderer.reset_frozen_views();
                        self.profiler.reset();
                    }
                });
            }
        });
        ui.collapsing("描画", |ui| {
            egui::ComboBox::from_label("描画解像度")
                .selected_text(self.resolution.label())
                .show_ui(ui, |ui| {
                    for mode in super::resolution::Resolution::ALL {
                        ui.selectable_value(&mut self.resolution, mode, mode.label());
                    }
                });
            ui.label(format!(
                "現在 {}×{}",
                self.renderer.size[0], self.renderer.size[1]
            ));
            ui.checkbox(&mut self.settings.culling, "フラスタムカリング");
            ui.checkbox(&mut self.settings.freeze, "カリング・配置を固定");
            ui.checkbox(&mut self.settings.wire, "ワイヤーフレーム");
        });
        ui.collapsing("カメラ", |ui| {
            if ui.button("カメラを戻す").clicked() {
                self.camera = Camera::default();
            }
            ui.add(egui::Slider::new(&mut self.settings.ev, -10.0..=15.0).text("露出 EV100"));
            ui.add(egui::Slider::new(&mut self.settings.fov, 30.0..=110.0).text("画角"));
            ui.add(
                egui::Slider::new(&mut self.camera.speed, 1.0..=1000.0)
                    .logarithmic(true)
                    .text("移動速度"),
            );
            ui.label(format!(
                "XYZ {:.1} / {:.1} / {:.1}",
                self.camera.position.x, self.camera.position.y, self.camera.position.z
            ));
            let forward = self.camera.forward();
            ui.label(format!("向き XYZ {:.3} / {:.3} / {:.3}", forward.x, forward.y, forward.z));
        });
        ui.collapsing("ライト", |ui| {
            ui.checkbox(&mut self.settings.direct, "直接光");
            ui.add(egui::Slider::new(&mut self.settings.azimuth, 0.0..=360.0).text("方位角"));
            ui.add(egui::Slider::new(&mut self.settings.elevation, 1.0..=89.0).text("仰角"));
        });
        egui::CollapsingHeader::new("シャドウ")
            .default_open(true)
            .show(ui, |ui| {
                ui.collapsing("ディレクショナルシャドウ", |ui| {
                    ui.checkbox(&mut self.settings.shadows, "有効（CSM生成）");
                    ui.checkbox(&mut self.settings.csm_apply_shadow, "シェーディングに適用");
                    ui.add(
                        egui::Slider::new(&mut self.settings.shadow_distance, 128.0..=16000.0)
                            .logarithmic(true)
                            .text("CSM距離"),
                    );
                    ui.add(
                        egui::Slider::new(&mut self.settings.depth_bias, 0.0..=1.0)
                            .text("深度バイアス m"),
                    );
                    ui.add(
                        egui::Slider::new(&mut self.settings.normal_bias, 0.0..=2.0)
                            .text("法線バイアス m"),
                    );
                    ui.add(egui::Slider::new(&mut self.settings.pcf, 0..=2).text("PCF半径"));
                    ui.checkbox(
                        &mut self.settings.caster_volume,
                        "ShadowCasterVolumeCulling",
                    );
                });
                ui.collapsing("PolarShadowCache", |ui| {
                    use crate::polar_shadow::Mapping;
                    let projection = crate::polar_shadow::Projection::new(self.camera.forward(),
                        crate::scene::light(&self.settings), self.settings.fov,
                        self.renderer.size[0] as f32 / self.renderer.size[1] as f32);
                    let csm_distance = self.settings.shadow_distance;
                    let o = &mut self.settings.polar;
                    ui.checkbox(&mut o.enabled, "有効");
                    ui.checkbox(&mut o.apply_shadow, "シェーディングに適用");
                    egui::ComboBox::from_label("マッピング").selected_text(o.mapping.label()).show_ui(ui, |ui| {
                        for mode in [Mapping::FullDisk, Mapping::ViewFitted] {
                            ui.selectable_value(&mut o.mapping, mode, mode.label());
                        }
                    });
                    ui.checkbox(&mut o.source_csm, "CSMをソースに使う");
                    ui.checkbox(&mut o.source_main_depth, "MainViewDepthBufferをソースに使う");
                    ui.collapsing("キャッシュ維持", |ui| {
                        let available = o.enabled && o.source_main_depth && o.mapping == Mapping::FullDisk;
                        ui.add_enabled_ui(available, |ui| {
                            ui.checkbox(&mut o.preserve_cache, "キャッシュ維持を有効にする");
                            ui.add_enabled(o.preserve_cache, egui::Slider::new(&mut o.history_push_speed, 0.0..=500.0)
                                .text("画面内の深度押し込み速度 m/s"));
                        });
                        ui.label("Full DiskのMainViewDepthBuffer履歴を維持します");
                    });
                    ui.collapsing("バイアス", |ui| {
                        ui.add_enabled_ui(o.source_main_depth, |ui| {
                            ui.checkbox(&mut o.caster_bias, "MainViewDepthのキャスターバイアス");
                            ui.add_enabled(o.caster_bias, egui::Slider::new(&mut o.caster_bias_constant, 0.0..=1024.0)
                                .logarithmic(true).text("固定押し込み m"));
                            ui.add_enabled(o.caster_bias, egui::Slider::new(&mut o.caster_bias_scale, 0.0..=16.0)
                                .text("セル寸法補正の倍率"));
                            ui.add_enabled(o.caster_bias,
                                egui::Slider::new(&mut o.caster_bias_limit, 0.0..=4096.0).logarithmic(true).text("キャスターバイアス上限 m"));
                        });
                        ui.add(egui::Slider::new(&mut o.receiver_bias, 0.0..=32.0).text("受光側の深度バイアス m"));
                    });
                    match o.mapping {
                        Mapping::FullDisk => {
                            ui.add(egui::Slider::new(&mut o.outer_radius, 128.0..=16000.0).logarithmic(true).text("外半径 m"));
                            ui.checkbox(&mut o.inner_follow_csm, "内半径をCSM距離に合わせる");
                            ui.add_enabled(!o.inner_follow_csm,
                                egui::Slider::new(&mut o.inner_radius, 0.0..=15999.0).text("内半径 m"));
                            ui.label(format!("半径方向のワールド範囲: {:.0} ～ {:.0} m", o.effective_inner(csm_distance), o.outer_radius));
                        }
                        Mapping::ViewFitted => {
                            ui.add(egui::Slider::new(&mut o.distance, 128.0..=16000.0).logarithmic(true).text("ビュー適合の最遠距離 m"));
                            ui.label(format!("円錐の半開き角: {:.1}°", projection.alpha.to_degrees()));
                            ui.label(format!("視線とライトの角度: {:.1}°", projection.beta.to_degrees()));
                            ui.label(format!("角度範囲: {:.1}°", 2.0 * projection.half_angle.to_degrees()));
                        }
                    }
                    for (axis, label) in ["角度方向の解像度", "半径方向の解像度"].into_iter().enumerate() {
                        egui::ComboBox::from_label(label).selected_text(format!("{} テクセル", o.size[axis])).show_ui(ui, |ui| {
                            for size in [256, 512, 1024, 2048, 3072, 4096] {
                                ui.selectable_value(&mut o.size[axis], size, size.to_string());
                            }
                        });
                    }
                    ui.checkbox(&mut o.pcf, "PCF");
                    ui.collapsing("デバッグ", |ui| {
                        ui.checkbox(&mut o.surface_grid, "サーフェイスのテクセル格子（16テクセル間隔）");
                        ui.checkbox(&mut o.world_debug, "ワールド空間に投影範囲を表示");
                        ui.add_enabled_ui(o.world_debug, |ui| {
                            ui.checkbox(&mut o.xray, "深度テスト無効");
                            ui.add(egui::Slider::new(&mut o.offset, -16000.0..=16000.0).text("表示オフセット m（光の進行方向）"));
                        });
                        ui.checkbox(&mut o.overlay, "画面上に表示");
                        ui.add_enabled_ui(o.overlay, |ui| {
                            ui.add(egui::Slider::new(&mut o.scale, 0.5..=3.0).text("表示スケール"));
                            ui.radio_value(&mut o.projected, true, "投影形状");
                            ui.radio_value(&mut o.projected, false, "2Dテクスチャ");
                        });
                        ui.checkbox(&mut o.grid, "デバッグ表示のテクセル格子（16テクセル間隔）");
                    });
                });
            });
        ui.collapsing("Sky", |ui| {
            ui.add(egui::Slider::new(&mut self.settings.sky, 0.0..=4.0).text("SkyLight"));
            ui.checkbox(&mut self.settings.specular, "Specular IBL");
            ui.checkbox(&mut self.settings.atmosphere_fog, "大気散乱フォグ");
            ui.checkbox(&mut self.settings.animate, "太陽を動かす");
        });
        ui.collapsing("Volumetric Fog", |ui| {
            let o = &mut self.settings.fog;
            ui.checkbox(&mut o.enabled, "有効");
            ui.checkbox(&mut o.shadow, "太陽光を遮蔽");
            if o.shadow && !self.settings.polar.enabled {
                ui.small("シャドウ → PolarShadowCacheの有効化が必要です");
            }
            ui.small("PSCで選択中のマッピングを使用します");
            ui.add(egui::Slider::new(&mut o.density, 0.0..=0.001).text("消散係数 1/m").max_decimals(6));
            ui.add(egui::Slider::new(&mut o.distance, 128.0..=16000.0).logarithmic(true).text("最大距離 m"));
            ui.add(egui::Slider::new(&mut o.anisotropy, 0.0..=0.9).text("異方性 g"));
            egui::ComboBox::from_label("ステップ数").selected_text(o.steps.to_string()).show_ui(ui, |ui| {
                for n in [8, 16, 32] { ui.selectable_value(&mut o.steps, n, n.to_string()); }
            });
            egui::ComboBox::from_label("計算解像度").selected_text(format!("縦横1/{}", o.divisor)).show_ui(ui, |ui| {
                for n in [2, 4, 8] { ui.selectable_value(&mut o.divisor, n, format!("縦横1/{n}")); }
            });
            ui.small("均一密度・単一散乱。キャッシュは1比較/ステップ、SkyLight散乱・履歴再利用は未対応");
        });
        ui.collapsing("地形", |ui| {
            ui.add(egui::DragValue::new(&mut self.settings.seed).prefix("シード "));
            ui.add(egui::Slider::new(&mut self.settings.amplitude, 0.0..=4000.0).text("標高振幅"));
            ui.add(
                egui::Slider::new(&mut self.settings.mountain_scale, 100.0..=10000.0)
                    .text("山スケール"),
            );
            egui::ComboBox::from_label("タイル密度")
                .selected_text(self.settings.density.to_string())
                .show_ui(ui, |ui| {
                    for n in [4, 8, 16, 32, 64] {
                        ui.selectable_value(&mut self.settings.density, n, n.to_string());
                    }
                });
            ui.add(
                egui::Slider::new(&mut self.settings.radius, 128.0..=16000.0)
                    .logarithmic(true)
                    .text("カバー半径"),
            );
            ui.checkbox(&mut self.settings.snap, "グリッドスナップ");
            ui.checkbox(&mut self.settings.constant_albedo, "固定アルベド");
            for (i, name) in ["R", "G", "B"].iter().enumerate() {
                ui.add(egui::Slider::new(&mut self.settings.albedo[i], 0.0..=1.0).text(*name));
            }
            ui.add(egui::Slider::new(&mut self.settings.roughness, 0.04..=1.0).text("ラフネス"));
            ui.add(egui::Slider::new(&mut self.settings.metallic, 0.0..=1.0).text("メタリック"));
        });
        ui.collapsing("Primitive", |ui| {
            let o = &mut self.settings.primitives;
            ui.checkbox(&mut o.enabled, "検証用の柱を表示");
            ui.add(egui::Slider::new(&mut o.side, 2000.0..=32000.0).text("配置領域の一辺 m"));
            ui.add(egui::Slider::new(&mut o.height, 100.0..=8000.0).text("柱の高さ m"));
            ui.add(egui::Slider::new(&mut o.width, 50.0..=2000.0).text("柱の幅 m"));
            for (i, label) in ["アルベド R", "アルベド G", "アルベド B"].iter().enumerate() {
                ui.add(egui::Slider::new(&mut o.albedo[i], 0.0..=1.0).text(*label));
            }
            ui.add(egui::Slider::new(&mut o.roughness, 0.04..=1.0).text("ラフネス"));
            ui.add(egui::Slider::new(&mut o.metallic, 0.0..=1.0).text("メタリック"));
            ui.small("ワールド原点を中心とした4辺中央に固定配置。地形のカバー半径とは独立");
            ui.label("4インスタンス・1共有メッシュ・12 Tri/本・各パス最大1 Draw");
        });
        ui.collapsing("樹木", |ui| {
            ui.checkbox(&mut self.settings.trees, "樹木を表示");
            ui.add(egui::Slider::new(&mut self.settings.tree_density, 0.0..=1.0).text("密度"));
            ui.add(egui::Slider::new(&mut self.settings.tree_budget, 1..=8).text("生成チャンク数"));
            egui::ComboBox::from_label("枝葉LOD")
                .selected_text(if self.settings.leaf_lod < 0 {
                    "自動".into()
                } else {
                    format!("LOD{}固定", self.settings.leaf_lod)
                })
                .show_ui(ui, |ui| {
                    ui.selectable_value(&mut self.settings.leaf_lod, -1, "自動");
                    for lod in 0..4 {
                        ui.selectable_value(
                            &mut self.settings.leaf_lod,
                            lod,
                            format!("LOD{lod}固定"),
                        );
                    }
                });
            egui::ComboBox::from_label("樹木デバッグ")
                .selected_text(
                    ["通常表示", "幹LOD", "チャンク", "Draw", "枝葉LOD"]
                        [self.settings.tree_debug as usize],
                )
                .show_ui(ui, |ui| {
                    for (i, n) in ["通常表示", "幹LOD", "チャンク", "Draw", "枝葉LOD"]
                        .iter()
                        .enumerate()
                    {
                        ui.selectable_value(&mut self.settings.tree_debug, i as u32, *n);
                    }
                });
            ui.label(&self.renderer.foliage.stats);
        });
        ui.collapsing("デバッグ", |ui| {
            egui::ComboBox::from_label("メインビュー")
                .selected_text(
                    ["通常表示", "RawDepth", "LinearDepth"][self.settings.debug as usize],
                )
                .show_ui(ui, |ui| {
                    for (i, n) in ["通常表示", "RawDepth", "LinearDepth"].iter().enumerate() {
                        ui.selectable_value(&mut self.settings.debug, i as u32, *n);
                    }
                });
            ui.add(
                egui::Slider::new(&mut self.settings.linear_distance, 1.0..=16000.0)
                    .logarithmic(true)
                    .text("正規化距離 m"),
            );
            ui.checkbox(&mut self.settings.normals, "法線");
            ui.checkbox(&mut self.settings.tile_colors, "タイル色分け");
            ui.checkbox(&mut self.settings.height_colors, "Height Clipmap色分け");
            ui.checkbox(&mut self.settings.height_grid, "HeightMap 16テクセル格子");
            ui.checkbox(&mut self.settings.shadow_debug, "Shadow Atlas RawDepth");
            ui.checkbox(&mut self.settings.csm_colors, "CSM色分け");
            ui.checkbox(&mut self.settings.csm_grid, "CSMテクセル格子");
            ui.add(
                egui::Slider::new(&mut self.settings.grid_texels, 1.0..=64.0).text("CSM格子間隔"),
            );
            ui.checkbox(&mut self.settings.shadow_mask, "Shadow可視率");
            ui.checkbox(&mut self.settings.sky_debug, "Sky Octahedral");
            ui.checkbox(&mut self.settings.specular_debug, "GGX Octahedral");
            ui.add(egui::Slider::new(&mut self.renderer.specular_mip, 0..=4).text("GGX Mip"));
        });
        ui.collapsing("構成情報", |ui| {
            ui.label(&self.adapter);
            ui.label(format!(
                "描画 {}×{}",
                self.renderer.size[0], self.renderer.size[1]
            ));
            ui.label(format!("Height更新 {}サンプル", self.renderer.samples));
            ui.label("FP16 Height Clipmap・共有IB・VBなし");
            ui.label("Reversed Z / HDR / CSM 4×1024²");
        });
    }
}
