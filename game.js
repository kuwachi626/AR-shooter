import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js";
import * as OIMO from "https://cdn.jsdelivr.net/npm/oimo@1.0.9/build/oimo.module.js";

// ゲーム状態
const gameState = {
    score: 0,
    hp: 3,
    timeLeft: 60,
    isPlaying: false,
    enemies: [],
    bullets: [],
};

// Three.js要素
let scene, camera, renderer, reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
let controller; // 右コントローラー
let controllerLeft; // 左コントローラー
let arTitleGroup;
let startButton3D;

// 物理エンジン
let world;

// UI要素
const startBtn = document.getElementById("start-ar-btn");
const restartBtn = document.getElementById("restart-btn");
const startScreen = document.getElementById("start-screen");
const gameUI = document.getElementById("game-ui");
const gameOverScreen = document.getElementById("game-over-screen");
const scoreEl = document.getElementById("score");
const hpEl = document.getElementById("hp");
const timerEl = document.getElementById("timer");
const finalScoreEl = document.getElementById("final-score");

// 初期化
function init() {
    // シーン作成
    scene = new THREE.Scene();

    // カメラ作成
    camera = new THREE.PerspectiveCamera(
        70,
        window.innerWidth / window.innerHeight,
        0.01,
        20,
    );

    // レンダラー作成
    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;

    // AR用の設定（outputEncodingはThree.js r152以降非推奨なので削除）
    renderer.shadowMap.enabled = false; // ARではシャドウを無効化

    document.body.appendChild(renderer.domElement);

    console.log("Three.jsレンダラー初期化完了");

    // 物理ワールドの初期化
    world = new OIMO.World({
        timestep: 1 / 60,
        iterations: 8,
        broadphase: 2,
        worldscale: 1,
        random: true,
        info: false,
        gravity: [0, -9.8, 0], // 重力
    });
    console.log("物理ワールド初期化完了");

    // ライト追加（ARでは環境光を控えめに）
    const light = new THREE.HemisphereLight(0xffffff, 0x888888, 0.6);
    scene.add(light);

    // 方向光を追加（影とリアリティのため）
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0, 5, 5);
    scene.add(directionalLight);

    // 右コントローラー（銃として使用）
    controller = renderer.xr.getController(1); // 0=左, 1=右
    controller.addEventListener("select", onTriggerPress);
    controller.addEventListener(
        "selectstart",
        () => console.log("コントローラー1: トリガー開始"),
    );
    controller.addEventListener(
        "selectend",
        () => console.log("コントローラー1: トリガー終了"),
    );
    scene.add(controller);

    // 左コントローラーも追加（フォールバック用）
    controllerLeft = renderer.xr.getController(0);
    controllerLeft.addEventListener("select", onTriggerPress);
    controllerLeft.addEventListener(
        "selectstart",
        () => console.log("コントローラー0: トリガー開始"),
    );
    scene.add(controllerLeft);

    // 右コントローラーに銃のビジュアルを追加
    const gunGeometry = new THREE.BoxGeometry(0.05, 0.05, 0.2);
    const gunMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const gunMesh = new THREE.Mesh(gunGeometry, gunMaterial);
    gunMesh.position.z = -0.1;
    controller.add(gunMesh);

    // 銃口のマーカー
    const muzzleGeometry = new THREE.CylinderGeometry(0.01, 0.01, 0.02, 8);
    const muzzleMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const muzzle = new THREE.Mesh(muzzleGeometry, muzzleMaterial);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.z = -0.2;
    controller.add(muzzle);

    // 左コントローラーにも銃のビジュアルを追加
    const gunGeometryLeft = new THREE.BoxGeometry(0.05, 0.05, 0.2);
    const gunMaterialLeft = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const gunMeshLeft = new THREE.Mesh(gunGeometryLeft, gunMaterialLeft);
    gunMeshLeft.position.z = -0.1;
    controllerLeft.add(gunMeshLeft);

    const muzzleGeometryLeft = new THREE.CylinderGeometry(0.01, 0.01, 0.02, 8);
    const muzzleMaterialLeft = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const muzzleLeft = new THREE.Mesh(muzzleGeometryLeft, muzzleMaterialLeft);
    muzzleLeft.rotation.x = Math.PI / 2;
    muzzleLeft.position.z = -0.2;
    controllerLeft.add(muzzleLeft);

    console.log("コントローラー設定完了");

    // ウィンドウリサイズ対応
    window.addEventListener("resize", onWindowResize);

    // 画面タップ/クリック検出
    window.addEventListener("click", onSelect);
}

// 3D空間にタイトル画面を作成
function create3DTitleScreen() {
    arTitleGroup = new THREE.Group();

    // タイトルテキスト用のキャンバステクスチャ
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");

    // 背景（半透明パネル）
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // タイトルテキスト
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 80px Arial";
    ctx.textAlign = "center";
    ctx.fillText("🎯 AR Shooter", canvas.width / 2, 150);

    // サブタイトル
    ctx.font = "40px Arial";
    ctx.fillText("周囲を見回して敵を撃破しよう!", canvas.width / 2, 250);

    // ボタンテキスト
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(312, 320, 400, 100);
    ctx.fillStyle = "#000000";
    ctx.font = "bold 50px Arial";
    ctx.fillText("ゲーム開始", canvas.width / 2, 390);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
    });
    const geometry = new THREE.PlaneGeometry(2, 1);
    const titleMesh = new THREE.Mesh(geometry, material);

    arTitleGroup.add(titleMesh);

    // スタートボタン用の当たり判定（小さい透明な平面）
    const buttonGeometry = new THREE.PlaneGeometry(0.8, 0.2);
    const buttonMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.01,
    });
    startButton3D = new THREE.Mesh(buttonGeometry, buttonMaterial);
    startButton3D.position.set(0, -0.3, 0.01);
    startButton3D.userData.isStartButton = true;

    arTitleGroup.add(startButton3D);

    // カメラの前方2mに配置
    arTitleGroup.position.set(0, 0, -2);

    return arTitleGroup;
}

// WebXR セッション開始
async function startAR() {
    if (!navigator.xr) {
        alert("お使いのデバイスはWebXRに対応していません");
        return;
    }

    // デバイスのAR対応確認
    const isARSupported = await navigator.xr.isSessionSupported("immersive-ar");
    console.log("ARサポート状況:", isARSupported);

    if (!isARSupported) {
        alert(
            "このデバイスはARモードに対応していません。\nQuest 3のブラウザ設定で「パススルー」を有効にしてください。",
        );
        return;
    }

    try {
        console.log("ARセッションをリクエスト中...");

        // 最小限の機能でARセッションを開始
        const sessionInit = {
            requiredFeatures: ["local"],
            optionalFeatures: ["hit-test", "dom-overlay", "local-floor"],
        };

        // dom-overlayはUI要素がある場合のみ追加
        if (document.body) {
            sessionInit.domOverlay = { root: document.body };
        }

        const session = await navigator.xr.requestSession(
            "immersive-ar",
            sessionInit,
        );
        console.log("ARセッション開始成功");

        await renderer.xr.setSession(session);

        // ヒットテストソースのリクエスト（オプション）
        try {
            const referenceSpace = await session.requestReferenceSpace(
                "viewer",
            );
            const source = await session.requestHitTestSource({
                space: referenceSpace,
            });
            hitTestSource = source;
            console.log("ヒットテストソース取得成功");
        } catch (e) {
            console.warn("ヒットテスト機能は利用できません:", e);
        }

        // セッション終了時の処理
        session.addEventListener("end", () => {
            console.log("ARセッション終了");
            hitTestSourceRequested = false;
            hitTestSource = null;
            gameState.isPlaying = false;
        });

        // 画面切り替え（3Dタイトル画面を作成・表示）
        startScreen.style.display = "none";

        const titleScreen3D = create3DTitleScreen();
        scene.add(titleScreen3D);

        console.log("3Dタイトル画面を表示");
    } catch (error) {
        console.error("AR セッションの開始に失敗:", error);
        console.error("エラー名:", error.name);
        console.error("エラーメッセージ:", error.message);

        let errorMsg = "AR機能を開始できませんでした。\n\n";

        if (error.name === "NotSupportedError") {
            errorMsg +=
                "ARモードがサポートされていません。\nQuest 3のブラウザ設定を確認してください。";
        } else if (error.name === "SecurityError") {
            errorMsg += "HTTPSまたはlocalhostでアクセスしてください。";
        } else if (error.name === "NotAllowedError") {
            errorMsg +=
                "AR権限が拒否されました。\nブラウザの設定を確認してください。";
        } else {
            errorMsg += "エラー: " + error.message;
        }

        alert(errorMsg);
    }
}

// ゲーム開始
function startGame() {
    gameState.score = 0;
    gameState.hp = 3;
    gameState.timeLeft = 60;
    gameState.isPlaying = true;
    gameState.enemies = [];

    updateUI();

    // タイマー開始
    const timerInterval = setInterval(() => {
        if (!gameState.isPlaying) {
            clearInterval(timerInterval);
            return;
        }

        gameState.timeLeft--;
        updateUI();

        if (gameState.timeLeft <= 0) {
            endGame();
            clearInterval(timerInterval);
        }
    }, 1000);

    // 敵生成開始
    spawnEnemies();
}

// 敵を生成
function spawnEnemies() {
    const spawnInterval = setInterval(() => {
        if (!gameState.isPlaying) {
            clearInterval(spawnInterval);
            return;
        }

        createEnemy();
    }, 2000); // 2秒ごとに敵生成
}

// 敵を作成
function createEnemy() {
    const colors = [0x00ff00, 0xff0000, 0xffff00, 0x00ffff];
    const color = colors[Math.floor(Math.random() * colors.length)];

    // よりリアルなサイズ（20cm）
    const geometry = new THREE.SphereGeometry(0.1, 32, 32);
    const material = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.5,
        metalness: 0.3,
        roughness: 0.4,
    });
    const enemy = new THREE.Mesh(geometry, material);

    // カメラ位置を基準に配置
    const cameraPos = camera.position.clone();
    const cameraDir = new THREE.Vector3(0, 0, -1);
    cameraDir.applyQuaternion(camera.quaternion);

    // カメラの前方1〜3m、左右1m、高さは目線付近
    const distance = 1.0 + Math.random() * 2.0; // 1〜3m先
    const horizontalOffset = (Math.random() - 0.5) * 2.0; // 左右1m
    const verticalOffset = -0.3 + Math.random() * 0.6; // 視線付近±30cm

    // カメラの向きに基づいて配置
    const right = new THREE.Vector3(1, 0, 0);
    right.applyQuaternion(camera.quaternion);

    enemy.position.copy(cameraPos)
        .add(cameraDir.multiplyScalar(distance))
        .add(right.multiplyScalar(horizontalOffset))
        .add(new THREE.Vector3(0, verticalOffset, 0));

    enemy.userData.isEnemy = true;
    enemy.userData.speed = 0.005 + Math.random() * 0.01;

    // カメラに向かってゆっくり移動
    const directionToCamera = new THREE.Vector3()
        .subVectors(cameraPos, enemy.position)
        .normalize()
        .multiplyScalar(enemy.userData.speed);

    enemy.userData.direction = directionToCamera;
    enemy.userData.birthTime = Date.now();

    scene.add(enemy);
    gameState.enemies.push(enemy);
}

// コントローラートリガー押下時
function onTriggerPress(event) {
    console.log("トリガーが押されました", event);

    // イベント発生元のコントローラーを取得
    const sourceController = event.target;
    console.log("コントローラー情報:", sourceController);

    // タイトル画面のボタンチェック
    if (startButton3D && startButton3D.parent) {
        const raycaster = new THREE.Raycaster();
        const tempMatrix = new THREE.Matrix4();
        tempMatrix.identity().extractRotation(sourceController.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(
            sourceController.matrixWorld,
        );
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

        const buttonIntersects = raycaster.intersectObject(startButton3D, true);
        if (buttonIntersects.length > 0) {
            console.log("3Dゲーム開始ボタンがクリックされました");
            scene.remove(arTitleGroup);
            arTitleGroup = null;
            startButton3D = null;
            gameUI.style.display = "block";
            startGame();
            return;
        }
    }

    // タイトル画面またはゲーム中は弾丸を発射
    console.log("弾丸発射を試みます...");
    shootBullet(sourceController);
}

// 弾丸を発射
function shootBullet(sourceController) {
    // コントローラーが渡されない場合はデフォルトのコントローラーを使用
    const activeController = sourceController || controller;

    if (!activeController || !activeController.matrixWorld) {
        console.error("コントローラーが見つかりません");
        return;
    }

    const bulletGeometry = new THREE.SphereGeometry(0.02, 8, 8);
    const bulletMaterial = new THREE.MeshBasicMaterial({
        color: 0xffff00,
        emissive: 0xffff00,
        emissiveIntensity: 1,
    });
    const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);

    // コントローラーの位置と向きから弾丸を発射
    const controllerPos = new THREE.Vector3();
    const controllerDir = new THREE.Vector3(0, 0, -1);

    controllerPos.setFromMatrixPosition(activeController.matrixWorld);
    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(activeController.matrixWorld);
    controllerDir.applyMatrix4(tempMatrix);

    bullet.position.copy(controllerPos);

    // 物理ボディを作成
    const bulletBody = world.add({
        type: "sphere",
        size: [0.02], // 半径
        pos: [controllerPos.x, controllerPos.y, controllerPos.z],
        move: true,
        density: 1,
        friction: 0.2,
        restitution: 0.5, // 反発係数
    });

    // 初速度を設定（弾速 15m/s）
    const velocity = controllerDir.normalize().multiplyScalar(15);
    bulletBody.linearVelocity.set(velocity.x, velocity.y, velocity.z);

    bullet.userData.body = bulletBody;
    bullet.userData.birthTime = Date.now();

    scene.add(bullet);
    gameState.bullets.push(bullet);

    // バイブレーション
    if (navigator.vibrate) {
        navigator.vibrate(30);
    }

    console.log(
        "弾丸発射成功:",
        bullet.position,
        "方向:",
        bullet.userData.direction,
    );
}

// 射撃処理（画面タップ用）
function onSelect(event) {
    // レイキャスター準備
    const raycaster = new THREE.Raycaster();

    // カメラ中心から（タップ/クリック - 画面タップ用フォールバック）
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

    // 3Dスタートボタンのチェック
    if (startButton3D && startButton3D.parent) {
        const buttonIntersects = raycaster.intersectObject(startButton3D, true);
        if (buttonIntersects.length > 0) {
            console.log("3Dゲーム開始ボタンがクリックされました（タップ）");
            scene.remove(arTitleGroup);
            arTitleGroup = null;
            startButton3D = null;
            gameUI.style.display = "block";
            startGame();
            return;
        }
    }

    // ゲーム中は画面タップで弾丸発射（コントローラーなしの場合）
    if (gameState.isPlaying) {
        shootBulletFromCamera();
    }
}

// カメラ中心から弾丸発射（画面タップ用フォールバック）
function shootBulletFromCamera() {
    const bulletGeometry = new THREE.SphereGeometry(0.02, 8, 8);
    const bulletMaterial = new THREE.MeshBasicMaterial({
        color: 0xffff00,
        emissive: 0xffff00,
        emissiveIntensity: 1,
    });
    const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);

    const cameraPos = camera.position.clone();
    const cameraDir = new THREE.Vector3(0, 0, -1);
    cameraDir.applyQuaternion(camera.quaternion);

    bullet.position.copy(cameraPos);

    // 物理ボディを作成
    const bulletBody = world.add({
        type: "sphere",
        size: [0.02],
        pos: [cameraPos.x, cameraPos.y, cameraPos.z],
        move: true,
        density: 1,
        friction: 0.2,
        restitution: 0.5,
    });

    const velocity = cameraDir.normalize().multiplyScalar(15);
    bulletBody.linearVelocity.set(velocity.x, velocity.y, velocity.z);

    bullet.userData.body = bulletBody;
    bullet.userData.birthTime = Date.now();

    scene.add(bullet);
    gameState.bullets.push(bullet);

    console.log("弾丸発射（カメラ）:", bullet.position);
}

// ヒットエフェクト
function createHitEffect(position) {
    const geometry = new THREE.SphereGeometry(0.1, 8, 8);
    const material = new THREE.MeshBasicMaterial({
        color: 0xffff00,
        transparent: true,
        opacity: 1,
    });
    const effect = new THREE.Mesh(geometry, material);
    effect.position.copy(position);
    scene.add(effect);

    // フェードアウトアニメーション
    let scale = 1;
    const fadeInterval = setInterval(() => {
        scale += 0.1;
        effect.scale.set(scale, scale, scale);
        effect.material.opacity -= 0.1;

        if (effect.material.opacity <= 0) {
            scene.remove(effect);
            clearInterval(fadeInterval);
        }
    }, 30);
}

// UI更新
function updateUI() {
    scoreEl.textContent = gameState.score;
    timerEl.textContent = gameState.timeLeft;

    const hearts = "❤️".repeat(gameState.hp);
    hpEl.textContent = hearts || "💀";
}

// ゲーム終了
function endGame() {
    gameState.isPlaying = false;

    // 全ての敵を削除
    gameState.enemies.forEach((enemy) => scene.remove(enemy));
    gameState.enemies = [];

    // 全ての弾丸を削除
    gameState.bullets.forEach((bullet) => {
        if (bullet.userData.body) {
            world.removeRigidBody(bullet.userData.body);
        }
        scene.remove(bullet);
    });
    gameState.bullets = [];

    // ゲームオーバー画面表示
    gameUI.style.display = "none";
    gameOverScreen.style.display = "flex";
    finalScoreEl.textContent = gameState.score;
}

// ウィンドウリサイズ
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// アニメーションループ
function animate() {
    renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
    // 物理ワールドの更新
    world.step();

    // ARヒットテストの処理
    if (frame && hitTestSource) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const hitTestResults = frame.getHitTestResults(hitTestSource);

        if (hitTestResults.length > 0) {
            const hit = hitTestResults[0];
            // AR平面が検出されている（必要に応じてレティクル表示可能）
        }
    }

    // 弾丸の物理位置をThree.jsメッシュに同期
    gameState.bullets.forEach((bullet) => {
        if (bullet.userData.body) {
            const body = bullet.userData.body;
            bullet.position.set(
                body.getPosition().x,
                body.getPosition().y,
                body.getPosition().z,
            );
            bullet.quaternion.set(
                body.getQuaternion().x,
                body.getQuaternion().y,
                body.getQuaternion().z,
                body.getQuaternion().w,
            );
        }
    });

    const cameraPos = camera.position;

    // 弾丸の衝突判定（移動は物理エンジンが処理）
    gameState.bullets.forEach((bullet, bulletIndex) => {
        // 寿命チェック（3秒または30m以上）
        const lifetime = Date.now() - bullet.userData.birthTime;
        const distance = bullet.position.distanceTo(cameraPos);

        if (lifetime > 3000 || distance > 30) {
            // 物理ボディを削除
            if (bullet.userData.body) {
                world.removeRigidBody(bullet.userData.body);
            }
            scene.remove(bullet);
            gameState.bullets = gameState.bullets.filter((b) => b !== bullet);
            return;
        }

        // タイトル画面のスタートボタンとの衝突判定
        if (startButton3D && startButton3D.parent) {
            const buttonWorldPos = new THREE.Vector3();
            startButton3D.getWorldPosition(buttonWorldPos);
            const distanceToButton = bullet.position.distanceTo(buttonWorldPos);

            if (distanceToButton < 0.5) {
                console.log("弾丸がスタートボタンに命中！ゲーム開始");
                // 弾丸を削除
                if (bullet.userData.body) {
                    world.removeRigidBody(bullet.userData.body);
                }
                scene.remove(bullet);
                gameState.bullets = gameState.bullets.filter((b) =>
                    b !== bullet
                );

                // ゲーム開始
                scene.remove(arTitleGroup);
                arTitleGroup = null;
                startButton3D = null;
                gameUI.style.display = "block";
                startGame();

                // バイブレーション
                if (navigator.vibrate) {
                    navigator.vibrate(100);
                }
                return;
            }
        }
    });

    if (gameState.isPlaying) {
        // 弾丸と敵の衝突判定
        gameState.bullets.forEach((bullet, bulletIndex) => {
            // 寿命チェック（3秒または30m以上）
            const lifetime = Date.now() - bullet.userData.birthTime;
            const distance = bullet.position.distanceTo(cameraPos);

            if (lifetime > 3000 || distance > 30) {
                // 物理ボディを削除
                if (bullet.userData.body) {
                    world.removeRigidBody(bullet.userData.body);
                }
                scene.remove(bullet);
                gameState.bullets = gameState.bullets.filter((b) =>
                    b !== bullet
                );
                return;
            }

            // 敵との衝突判定
            gameState.enemies.forEach((enemy) => {
                const distanceToEnemy = bullet.position.distanceTo(
                    enemy.position,
                );
                if (distanceToEnemy < 0.15) { // 衝突範囲
                    // ヒット！
                    console.log("敵にヒット！");

                    // スコア加算
                    const shootDistance = bullet.userData.birthTime
                        ? bullet.position.distanceTo(cameraPos)
                        : 2;
                    const bonus = Math.floor(shootDistance * 2);
                    gameState.score += 10 + bonus;
                    updateUI();

                    // エフェクト
                    enemy.material.emissiveIntensity = 2;
                    createHitEffect(enemy.position);

                    // 敵と弾丸を削除
                    scene.remove(enemy);
                    scene.remove(bullet);
                    gameState.enemies = gameState.enemies.filter((e) =>
                        e !== enemy
                    );
                    gameState.bullets = gameState.bullets.filter((b) =>
                        b !== bullet
                    );

                    // バイブレーション
                    if (navigator.vibrate) {
                        navigator.vibrate(50);
                    }
                }
            });
        });

        // 敵の移動
        gameState.enemies.forEach((enemy, index) => {
            // カメラに向かって移動
            const directionToCamera = new THREE.Vector3()
                .subVectors(cameraPos, enemy.position)
                .normalize()
                .multiplyScalar(enemy.userData.speed);

            enemy.userData.direction = directionToCamera;
            enemy.position.add(enemy.userData.direction);

            // カメラとの距離チェック
            const distanceToCamera = enemy.position.distanceTo(cameraPos);

            // カメラに近づきすぎたらダメージ＆削除
            if (distanceToCamera < 0.3) {
                gameState.hp--;
                updateUI();
                scene.remove(enemy);
                gameState.enemies = gameState.enemies.filter((e) =>
                    e !== enemy
                );

                if (gameState.hp <= 0) {
                    endGame();
                }
                return;
            }

            // 遠すぎたり、存在時間が長すぎたら削除
            const lifetime = Date.now() - enemy.userData.birthTime;
            if (distanceToCamera > 5 || lifetime > 30000) {
                scene.remove(enemy);
                gameState.enemies = gameState.enemies.filter((e) =>
                    e !== enemy
                );
                return;
            }

            // 回転アニメーション（よりゆっくり）
            enemy.rotation.x += 0.02;
            enemy.rotation.y += 0.02;

            // 距離に応じて明滅（プレイヤーへの警告）
            if (distanceToCamera < 1.0) {
                enemy.material.emissiveIntensity = 0.5 +
                    Math.sin(timestamp * 0.01) * 0.3;
            }
        });
    }

    renderer.render(scene, camera);
}

// イベントリスナー
startBtn.addEventListener("click", () => {
    console.log("ARで遊ぶボタンがクリックされました");
    startAR();
});

restartBtn.addEventListener("click", () => {
    console.log("もう一度遊ぶボタンがクリックされました");
    gameOverScreen.style.display = "none";

    // 3Dタイトル画面を再表示
    const titleScreen3D = create3DTitleScreen();
    scene.add(titleScreen3D);
});

// 初期化と開始
console.log("アプリケーション初期化中...");
init();
animate();
console.log("アプリケーション起動完了");

// WebXR対応状況を確認
if (navigator.xr) {
    navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
        console.log("immersive-ar サポート:", supported);
        if (!supported) {
            console.warn("このデバイスはARモードをサポートしていません");
        }
    });

    navigator.xr.isSessionSupported("immersive-vr").then((supported) => {
        console.log("immersive-vr サポート:", supported);
    });
} else {
    console.error("navigator.xr が利用できません");
}
