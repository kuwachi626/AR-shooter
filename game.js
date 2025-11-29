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
    gameMode: "classic", // 'classic', 'survival', 'timeattack'
};

// ゲームモード設定
const gameModes = {
    classic: {
        name: "クラシック",
        description: "60秒間でハイスコアを目指せ！",
        time: 60,
        hp: 3,
        spawnInterval: 2000,
    },
    survival: {
        name: "サバイバル",
        description: "HP制限！何体倒せるか挑戦",
        time: 999,
        hp: 5,
        spawnInterval: 1500,
    },
    timeattack: {
        name: "タイムアタック",
        description: "30秒の高速バトル！",
        time: 30,
        hp: 3,
        spawnInterval: 1000,
    },
};

// スコア履歴管理（モード別）
function saveScore(score, mode) {
    const storageKey = `arShooterScores_${mode}`;
    let scores = getScoreHistory(mode);
    scores.push(score);
    scores.sort((a, b) => b - a); // 降順ソート
    scores = scores.slice(0, 10); // 上位10個まで保存
    localStorage.setItem(storageKey, JSON.stringify(scores));
}

function getScoreHistory(mode) {
    const storageKey = `arShooterScores_${mode}`;
    const saved = localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) : [];
}

function getTopScores(mode, count = 3) {
    const scores = getScoreHistory(mode);
    return scores.slice(0, count);
}

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

// 視界外警告システム用のキャンバス
let warningCanvas, warningCtx;
// 3D警告インジケーター
let warningIndicators = [];
// 3D UI要素（スコア、HP、タイマー）
let scoreUI3D, hpUI3D, timerUI3D;
// 3Dゲームオーバー画面
let gameOver3DGroup, restartButton3D;
// 3Dモード選択画面
let modeSelect3DGroup, modeButtons;
// 銃声SE
let shotSound;
// ダメージSE
let damageSound;
// ヒットSE
let hitSound;

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

    // 視界外警告用のキャンバスを作成
    createWarningCanvas();

    // 3D HUDを作成
    create3DHUD();

    // 3Dモード選択画面を作成
    create3DModeSelectScreen();

    // 3Dゲームオーバー画面を作成
    create3DGameOverScreen();

    // 銃声SEを読み込む
    shotSound = new Audio("SE/shot.mp3");
    shotSound.volume = 0.3; // 音量を調整（0.0〜1.0）

    // ダメージSEを読み込む
    damageSound = new Audio("SE/damage.mp3");
    damageSound.volume = 0.5; // 音量を調整（0.0〜1.0）

    // ヒットSEを読み込む
    hitSound = new Audio("SE/hit.mp3");
    hitSound.volume = 0.4; // 音量を調整（0.0〜1.0）

    // ウィンドウリサイズ対応
    window.addEventListener("resize", onWindowResize);

    // 画面タップ/クリック検出
    window.addEventListener("click", onSelect);
}

// 視界外警告用のキャンバスを作成
function createWarningCanvas() {
    warningCanvas = document.createElement("canvas");
    warningCanvas.width = window.innerWidth;
    warningCanvas.height = window.innerHeight;
    warningCanvas.style.position = "fixed";
    warningCanvas.style.top = "0";
    warningCanvas.style.left = "0";
    warningCanvas.style.pointerEvents = "none";
    warningCanvas.style.zIndex = "1000";
    document.body.appendChild(warningCanvas);
    warningCtx = warningCanvas.getContext("2d");
}

// AR空間に3D UIテキストを作成
function create3DHUD() {
    // スコア表示用のキャンバス
    const scoreCanvas = document.createElement("canvas");
    scoreCanvas.width = 256;
    scoreCanvas.height = 128;
    const scoreCtx = scoreCanvas.getContext("2d");

    const scoreTexture = new THREE.CanvasTexture(scoreCanvas);
    const scoreMaterial = new THREE.MeshBasicMaterial({
        map: scoreTexture,
        transparent: true,
        side: THREE.DoubleSide,
    });
    const scoreGeometry = new THREE.PlaneGeometry(0.3, 0.15);
    scoreUI3D = new THREE.Mesh(scoreGeometry, scoreMaterial);
    scoreUI3D.userData.canvas = scoreCanvas;
    scoreUI3D.userData.context = scoreCtx;
    scoreUI3D.userData.texture = scoreTexture;
    scene.add(scoreUI3D);

    // HP表示用のキャンバス
    const hpCanvas = document.createElement("canvas");
    hpCanvas.width = 256;
    hpCanvas.height = 128;
    const hpCtx = hpCanvas.getContext("2d");

    const hpTexture = new THREE.CanvasTexture(hpCanvas);
    const hpMaterial = new THREE.MeshBasicMaterial({
        map: hpTexture,
        transparent: true,
        side: THREE.DoubleSide,
    });
    const hpGeometry = new THREE.PlaneGeometry(0.3, 0.15);
    hpUI3D = new THREE.Mesh(hpGeometry, hpMaterial);
    hpUI3D.userData.canvas = hpCanvas;
    hpUI3D.userData.context = hpCtx;
    hpUI3D.userData.texture = hpTexture;
    scene.add(hpUI3D);

    // タイマー表示用のキャンバス
    const timerCanvas = document.createElement("canvas");
    timerCanvas.width = 256;
    timerCanvas.height = 128;
    const timerCtx = timerCanvas.getContext("2d");

    const timerTexture = new THREE.CanvasTexture(timerCanvas);
    const timerMaterial = new THREE.MeshBasicMaterial({
        map: timerTexture,
        transparent: true,
        side: THREE.DoubleSide,
    });
    const timerGeometry = new THREE.PlaneGeometry(0.3, 0.15);
    timerUI3D = new THREE.Mesh(timerGeometry, timerMaterial);
    timerUI3D.userData.canvas = timerCanvas;
    timerUI3D.userData.context = timerCtx;
    timerUI3D.userData.texture = timerTexture;
    scene.add(timerUI3D);
}

// 3D HUDの位置を更新（カメラに追従）
function update3DHUD() {
    if (!scoreUI3D || !hpUI3D || !timerUI3D) return;

    const cameraPos = camera.position;
    const cameraDir = new THREE.Vector3(0, 0, -1);
    cameraDir.applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0);
    right.applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0);
    up.applyQuaternion(camera.quaternion);

    const hudDistance = 0.7; // カメラから0.7m先（少し遠くして見やすく）

    // タイマー：左上（端から少し内側）
    const timerPos = cameraPos.clone()
        .add(cameraDir.clone().multiplyScalar(hudDistance))
        .add(right.clone().multiplyScalar(-0.18)) // 左上に配置
        .add(up.clone().multiplyScalar(0.15));
    timerUI3D.position.copy(timerPos);
    timerUI3D.quaternion.copy(camera.quaternion);
    timerUI3D.visible = gameState.isPlaying;

    // HP：左下（端から少し内側）
    const hpPos = cameraPos.clone()
        .add(cameraDir.clone().multiplyScalar(hudDistance))
        .add(right.clone().multiplyScalar(-0.18)) // -0.25から-0.18に（内側へ）
        .add(up.clone().multiplyScalar(-0.15)); // -0.2から-0.15に（少し上げる）
    hpUI3D.position.copy(hpPos);
    hpUI3D.quaternion.copy(camera.quaternion);
    hpUI3D.visible = gameState.isPlaying;

    // スコア：上中央（少し下げる）
    const scorePos = cameraPos.clone()
        .add(cameraDir.clone().multiplyScalar(hudDistance))
        .add(right.clone().multiplyScalar(0.10))
        .add(up.clone().multiplyScalar(0.15)); // 上中央に配置
    scoreUI3D.position.copy(scorePos);
    scoreUI3D.quaternion.copy(camera.quaternion);
    scoreUI3D.visible = gameState.isPlaying;
}

// 3D HUDのテキストを更新
function update3DUIText() {
    if (!scoreUI3D || !hpUI3D || !timerUI3D) return;

    // スコア更新
    const scoreCtx = scoreUI3D.userData.context;
    const scoreCanvas = scoreUI3D.userData.canvas;
    scoreCtx.clearRect(0, 0, scoreCanvas.width, scoreCanvas.height);

    // テキスト（背景なし）
    // 白い縁取りを追加して視認性を向上
    scoreCtx.strokeStyle = "#000000";
    scoreCtx.lineWidth = 4;
    scoreCtx.font = "bold 24px Arial";
    scoreCtx.strokeText("SCORE", 25, 45);
    scoreCtx.fillStyle = "#ffffff";
    scoreCtx.fillText("SCORE", 25, 45);

    scoreCtx.font = "bold 40px Arial";
    scoreCtx.strokeText(gameState.score.toString(), 25, 90);
    scoreCtx.fillStyle = "#ffff00";
    scoreCtx.fillText(gameState.score.toString(), 25, 90);
    scoreUI3D.userData.texture.needsUpdate = true;

    // HP更新
    const hpCtx = hpUI3D.userData.context;
    const hpCanvas = hpUI3D.userData.canvas;
    hpCtx.clearRect(0, 0, hpCanvas.width, hpCanvas.height);

    // テキスト（背景なし）
    // 白い縁取りを追加して視認性を向上
    hpCtx.strokeStyle = "#000000";
    hpCtx.lineWidth = 4;
    hpCtx.font = "bold 24px Arial";
    hpCtx.strokeText("HP", 25, 45);
    hpCtx.fillStyle = "#ffffff";
    hpCtx.fillText("HP", 25, 45);

    hpCtx.font = "bold 40px Arial";
    const hearts = "❤️".repeat(gameState.hp);
    const text = hearts || "💀";
    hpCtx.strokeText(text, 25, 90);
    hpCtx.fillStyle = "#ff0000";
    hpCtx.fillText(text, 25, 90);
    hpUI3D.userData.texture.needsUpdate = true;

    // タイマー更新
    const timerCtx = timerUI3D.userData.context;
    const timerCanvas = timerUI3D.userData.canvas;
    timerCtx.clearRect(0, 0, timerCanvas.width, timerCanvas.height);

    // テキスト（背景なし）
    // 白い縁取りを追加して視認性を向上
    timerCtx.textAlign = "center";
    timerCtx.strokeStyle = "#000000";
    timerCtx.lineWidth = 4;
    timerCtx.font = "bold 24px Arial";
    timerCtx.strokeText("TIME", timerCanvas.width / 2, 45);
    timerCtx.fillStyle = "#ffffff";
    timerCtx.fillText("TIME", timerCanvas.width / 2, 45);

    // 残り時間によって色を変える
    let timeColor;
    if (gameState.timeLeft <= 10) {
        timeColor = "#ff0000";
    } else if (gameState.timeLeft <= 30) {
        timeColor = "#ffaa00";
    } else {
        timeColor = "#00ff00";
    }

    timerCtx.font = "bold 40px Arial";
    timerCtx.strokeText(
        gameState.timeLeft.toString(),
        timerCanvas.width / 2,
        90,
    );
    timerCtx.fillStyle = timeColor;
    timerCtx.fillText(gameState.timeLeft.toString(), timerCanvas.width / 2, 90);
    timerUI3D.userData.texture.needsUpdate = true;
}

// AR空間に3Dモード選択画面を作成
function create3DModeSelectScreen() {
    modeSelect3DGroup = new THREE.Group();
    modeButtons = [];

    // モード選択画面用のキャンバス
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 900;
    const ctx = canvas.getContext("2d");

    // 背景（半透明パネル）
    ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // タイトル
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 60px Arial";
    ctx.textAlign = "center";
    ctx.fillText("ゲームモード選択", canvas.width / 2, 80);

    // 各モードのボタンを描画
    const modes = ["classic", "survival", "timeattack"];
    const colors = ["#4CAF50", "#FF9800", "#F44336"];
    let yPos = 150;

    modes.forEach((modeKey, index) => {
        const mode = gameModes[modeKey];

        // ボタン背景
        ctx.fillStyle = colors[index];
        ctx.fillRect(112, yPos, 800, 180);

        // ボタン枠
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 4;
        ctx.strokeRect(112, yPos, 800, 180);

        // モード名
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 50px Arial";
        ctx.fillText(mode.name, canvas.width / 2, yPos + 70);

        // 説明
        ctx.font = "30px Arial";
        ctx.fillText(mode.description, canvas.width / 2, yPos + 120);

        // モード詳細
        ctx.font = "25px Arial";
        const details = `時間: ${mode.time}秒 | HP: ${mode.hp} | 難易度: ${
            index === 0 ? "普通" : index === 1 ? "高" : "超高"
        }`;
        ctx.fillText(details, canvas.width / 2, yPos + 155);

        yPos += 230;
    });

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
    });
    const geometry = new THREE.PlaneGeometry(2.5, 2.2);
    const modeSelectMesh = new THREE.Mesh(geometry, material);
    modeSelectMesh.userData.canvas = canvas;
    modeSelectMesh.userData.context = ctx;
    modeSelectMesh.userData.texture = texture;

    modeSelect3DGroup.add(modeSelectMesh);

    // 各モードボタン用の当たり判定
    modes.forEach((modeKey, index) => {
        const buttonGeometry = new THREE.PlaneGeometry(2.0, 0.44);
        const buttonMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.01,
        });
        const button = new THREE.Mesh(buttonGeometry, buttonMaterial);
        button.position.set(0, 0.55 - index * 0.56, 0.01);
        button.userData.isModeButton = true;
        button.userData.mode = modeKey;
        modeSelect3DGroup.add(button);
        modeButtons.push(button);
    });

    // 初期状態は非表示
    modeSelect3DGroup.visible = false;

    scene.add(modeSelect3DGroup);
}

// 3Dモード選択画面の位置を更新
function update3DModeSelectScreen() {
    if (!modeSelect3DGroup || !modeSelect3DGroup.visible) return;

    const cameraPos = camera.position.clone();
    const cameraDir = new THREE.Vector3(0, 0, -1);
    cameraDir.applyQuaternion(camera.quaternion);

    // カメラの前方2mに配置
    const screenPos = cameraPos.clone().add(cameraDir.multiplyScalar(2));
    modeSelect3DGroup.position.copy(screenPos);

    // カメラの方を向く
    modeSelect3DGroup.quaternion.copy(camera.quaternion);
}

// AR空間に3Dゲームオーバー画面を作成
function create3DGameOverScreen() {
    gameOver3DGroup = new THREE.Group();

    // ゲームオーバー画面用のキャンバス
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 900; // 高さを増やしてランキング表示スペースを確保
    const ctx = canvas.getContext("2d");

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
    });
    const geometry = new THREE.PlaneGeometry(2.5, 2.2);
    const gameOverMesh = new THREE.Mesh(geometry, material);
    gameOverMesh.userData.canvas = canvas;
    gameOverMesh.userData.context = ctx;
    gameOverMesh.userData.texture = texture;

    gameOver3DGroup.add(gameOverMesh);

    // リスタートボタン用の当たり判定（透明な平面）
    const buttonGeometry = new THREE.PlaneGeometry(1.0, 0.3);
    const buttonMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.01,
    });
    restartButton3D = new THREE.Mesh(buttonGeometry, buttonMaterial);
    restartButton3D.position.set(0, -0.55, 0.01);
    restartButton3D.userData.isRestartButton = true;

    gameOver3DGroup.add(restartButton3D);

    // 初期状態は非表示
    gameOver3DGroup.visible = false;

    scene.add(gameOver3DGroup);
}

// 3Dゲームオーバー画面を完全に再描画
function update3DGameOverScore(score) {
    if (!gameOver3DGroup) return;

    const mesh = gameOver3DGroup.children[0];
    const ctx = mesh.userData.context;
    const canvas = mesh.userData.canvas;

    // キャンバス全体をクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 背景（半透明パネル）
    ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ゲームオーバーテキスト
    ctx.fillStyle = "#ff0000";
    ctx.font = "bold 100px Arial";
    ctx.textAlign = "center";
    ctx.fillText("GAME OVER", canvas.width / 2, 120);

    // 今回のスコア表示
    ctx.fillStyle = "#ffffff";
    ctx.font = "40px Arial";
    ctx.fillText("Your Score", canvas.width / 2, 210);

    ctx.fillStyle = "#ffff00";
    ctx.font = "bold 70px Arial";
    ctx.fillText(score.toString(), canvas.width / 2, 290);

    // 現在のモードのランキング表示
    const currentMode = gameState.gameMode || "classic";
    const topScores = getTopScores(currentMode, 3);
    if (topScores.length > 0) {
        // モード名を表示
        ctx.fillStyle = "#ffaa00";
        ctx.font = "bold 30px Arial";
        ctx.fillText(
            `[🎮 ${gameModes[currentMode].name}モード]`,
            canvas.width / 2,
            350,
        );

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 35px Arial";
        ctx.fillText("🏆 TOP 3 SCORES", canvas.width / 2, 395);

        const medals = ["🥇", "🥈", "🥉"];
        topScores.forEach((topScore, index) => {
            const yPos = 455 + index * 60;

            // ランキング番号とメダル
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 40px Arial";
            ctx.textAlign = "left";
            ctx.fillText(medals[index], 200, yPos);

            // スコア
            ctx.textAlign = "right";
            if (topScore === score && index === 0) {
                // 新記録の場合は強調
                ctx.fillStyle = "#ff00ff";
                ctx.font = "bold 50px Arial";
            } else {
                ctx.fillStyle = "#ffdd00";
                ctx.font = "bold 45px Arial";
            }
            ctx.fillText(topScore.toString(), 824, yPos);
        });
    }

    // リスタートボタンの背景
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(312, 650, 400, 100);

    // ボタンテキスト
    ctx.fillStyle = "#000000";
    ctx.font = "bold 45px Arial";
    ctx.textAlign = "center";
    ctx.fillText("もう一度遊ぶ", canvas.width / 2, 715);

    // 操作説明
    ctx.fillStyle = "#aaaaaa";
    ctx.font = "25px Arial";
    ctx.fillText("ボタンを見てトリガーを引いてください", canvas.width / 2, 820);

    mesh.userData.texture.needsUpdate = true;
}

// 3Dゲームオーバー画面の位置を更新（カメラの前に固定）
function update3DGameOverScreen() {
    if (!gameOver3DGroup || !gameOver3DGroup.visible) return;

    const cameraPos = camera.position.clone();
    const cameraDir = new THREE.Vector3(0, 0, -1);
    cameraDir.applyQuaternion(camera.quaternion);

    // カメラの前方2mに配置
    const screenPos = cameraPos.clone().add(cameraDir.multiplyScalar(2));
    gameOver3DGroup.position.copy(screenPos);

    // カメラの方を向く
    gameOver3DGroup.quaternion.copy(camera.quaternion);
}

// AR空間に3D警告インジケーターを作成
function create3DWarningIndicator() {
    const group = new THREE.Group();

    // 大きな赤い円形エフェクト（外側）
    const outerGeometry = new THREE.CircleGeometry(0.25, 32);
    const outerMaterial = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
    });
    const outerCircle = new THREE.Mesh(outerGeometry, outerMaterial);
    group.add(outerCircle);

    // 中くらいの円（中間）
    const middleGeometry = new THREE.CircleGeometry(0.18, 32);
    const middleMaterial = new THREE.MeshBasicMaterial({
        color: 0xff3333,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
    });
    const middleCircle = new THREE.Mesh(middleGeometry, middleMaterial);
    middleCircle.position.z = 0.001;
    group.add(middleCircle);

    // 小さな円（内側、明るく）
    const innerGeometry = new THREE.CircleGeometry(0.1, 32);
    const innerMaterial = new THREE.MeshBasicMaterial({
        color: 0xff6666,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
    });
    const innerCircle = new THREE.Mesh(innerGeometry, innerMaterial);
    innerCircle.position.z = 0.002;
    group.add(innerCircle);

    group.visible = false;
    return group;
}

// AR空間で視界外の敵の方向を示すインジケーターを更新
function update3DWarningIndicators() {
    if (!gameState.isPlaying) {
        warningIndicators.forEach((indicator) => indicator.visible = false);
        return;
    }

    const cameraPos = camera.position;
    const cameraDir = new THREE.Vector3(0, 0, -1);
    cameraDir.applyQuaternion(camera.quaternion);

    // 必要な数のインジケーターを確保
    while (warningIndicators.length < gameState.enemies.length) {
        const indicator = create3DWarningIndicator();
        scene.add(indicator);
        warningIndicators.push(indicator);
    }

    // すべてのインジケーターを非表示にしてからリセット
    warningIndicators.forEach((indicator) => indicator.visible = false);

    let indicatorIndex = 0;
    gameState.enemies.forEach((enemy) => {
        // 敵の方向ベクトル
        const enemyDir = new THREE.Vector3()
            .subVectors(enemy.position, cameraPos)
            .normalize();

        // カメラの向きとの角度を計算
        const dot = cameraDir.dot(enemyDir);
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

        // 視野角外（約40度以上）の敵にインジケーターを表示
        if (angle > 0.7) {
            const indicator = warningIndicators[indicatorIndex];
            indicator.visible = true;

            // カメラから見える視界内に配置（視界の60%の位置で見やすく）
            const indicatorDistance = 0.8; // カメラから0.8m先（より近く、見やすい位置）
            const enemyDistance = enemy.position.distanceTo(cameraPos);

            // 視界の端（視野角の境界）に配置するための方向を計算
            const right = new THREE.Vector3(1, 0, 0);
            right.applyQuaternion(camera.quaternion);
            const up = new THREE.Vector3(0, 1, 0);
            up.applyQuaternion(camera.quaternion);

            // 敵の方向を分解
            const horizontalComponent = right.dot(enemyDir);
            const verticalComponent = up.dot(enemyDir);
            const forwardComponent = cameraDir.dot(enemyDir);

            // 視界の見やすい位置に制限（視野角の約60%の位置）
            const maxAngle = 0.35; // 約20度（視界の中で見やすい位置）
            const horizontalAngle = Math.atan2(
                horizontalComponent,
                forwardComponent,
            );
            const verticalAngle = Math.atan2(
                verticalComponent,
                forwardComponent,
            );

            const clampedHorizontalAngle = Math.max(
                -maxAngle,
                Math.min(maxAngle, horizontalAngle),
            );
            const clampedVerticalAngle = Math.max(
                -maxAngle * 0.7,
                Math.min(maxAngle * 0.7, verticalAngle),
            );

            // 制限された角度から新しい方向ベクトルを作成
            const clampedDir = cameraDir.clone()
                .add(
                    right.clone().multiplyScalar(
                        Math.tan(clampedHorizontalAngle),
                    ),
                )
                .add(up.clone().multiplyScalar(Math.tan(clampedVerticalAngle)))
                .normalize();

            // インジケーターを視界内の見やすい位置に配置
            const indicatorPos = cameraPos.clone().add(
                clampedDir.clone().multiplyScalar(indicatorDistance),
            );
            indicator.position.copy(indicatorPos);

            // インジケーターをカメラの方向に向ける（ビルボード効果）
            indicator.quaternion.copy(camera.quaternion);

            // 距離に応じて色と大きさを変化
            const intensity = Math.max(0.4, 1 - enemyDistance / 5);
            const baseScale = 0.8 + intensity * 0.6; // より大きく表示

            // パルス効果（より強く）
            const pulse = 1 + Math.sin(Date.now() * 0.008) * 0.3;
            const pulseScale = baseScale * pulse;
            indicator.scale.set(pulseScale, pulseScale, pulseScale);

            // 外側の円
            indicator.children[0].material.opacity = 0.3 +
                intensity * 0.2 * pulse;
            // 中間の円
            indicator.children[1].material.opacity = 0.5 +
                intensity * 0.3 * pulse;
            // 内側の円
            indicator.children[2].material.opacity = 0.7 +
                intensity * 0.3 * pulse;

            // 敵が近い場合は色を濃く、より明るく
            if (enemyDistance < 2) {
                indicator.children[0].material.color.setHex(0xff0000);
                indicator.children[1].material.color.setHex(0xff3333);
                indicator.children[2].material.color.setHex(0xff6666);
            } else if (enemyDistance < 3) {
                indicator.children[0].material.color.setHex(0xff3333);
                indicator.children[1].material.color.setHex(0xff6666);
                indicator.children[2].material.color.setHex(0xff9999);
            } else {
                indicator.children[0].material.color.setHex(0xff6666);
                indicator.children[1].material.color.setHex(0xff9999);
                indicator.children[2].material.color.setHex(0xffcccc);
            }

            indicatorIndex++;
        }
    });
}

// 視界外の敵に対する警告を描画
function drawOffScreenWarnings() {
    if (!warningCtx || !gameState.isPlaying) return;

    // キャンバスをクリア
    warningCtx.clearRect(0, 0, warningCanvas.width, warningCanvas.height);

    const cameraPos = camera.position;
    const cameraDir = new THREE.Vector3(0, 0, -1);
    cameraDir.applyQuaternion(camera.quaternion);

    gameState.enemies.forEach((enemy) => {
        // 敵の方向ベクトル
        const enemyDir = new THREE.Vector3()
            .subVectors(enemy.position, cameraPos)
            .normalize();

        // カメラの向きとの角度を計算
        const dot = cameraDir.dot(enemyDir);
        const angle = Math.acos(dot);

        // 視野角（約60度 = 1.047ラジアン）外の敵に警告を表示
        if (angle > 0.7) { // 約40度以上
            // 敵が画面のどの方向にいるかを計算
            const right = new THREE.Vector3(1, 0, 0);
            right.applyQuaternion(camera.quaternion);
            const horizontalDot = right.dot(enemyDir);

            const up = new THREE.Vector3(0, 1, 0);
            up.applyQuaternion(camera.quaternion);
            const verticalDot = up.dot(enemyDir);

            // 画面端の位置を計算
            const centerX = warningCanvas.width / 2;
            const centerY = warningCanvas.height / 2;
            const margin = 50; // 画面端からのマージン

            // 角度から画面端の位置を決定
            let x, y;
            const absHorizontal = Math.abs(horizontalDot);
            const absVertical = Math.abs(verticalDot);

            // 左右の判定が強い場合
            if (absHorizontal > absVertical) {
                x = horizontalDot > 0 ? warningCanvas.width - margin : margin;
                y = centerY - verticalDot * 200;
            } else {
                // 上下の判定が強い場合
                x = centerX + horizontalDot * 200;
                y = verticalDot > 0 ? margin : warningCanvas.height - margin;
            }

            // 距離に応じて警告の強さを変える
            const distance = enemy.position.distanceTo(cameraPos);
            const intensity = Math.max(0.3, 1 - distance / 5);

            // 赤い三角形の警告マーカーを描画
            const size = 20 + (1 - intensity) * 10;
            const pulseScale = 1 + Math.sin(Date.now() * 0.005) * 0.2;

            warningCtx.save();
            warningCtx.translate(x, y);

            // 敵の方向を指す矢印
            const arrowAngle = Math.atan2(
                enemy.position.z - cameraPos.z,
                enemy.position.x - cameraPos.x,
            ) - Math.atan2(
                Math.sin(camera.rotation.y),
                Math.cos(camera.rotation.y),
            );

            warningCtx.rotate(Math.atan2(centerY - y, centerX - x));

            // グラデーションで警告を描画
            const gradient = warningCtx.createRadialGradient(
                0,
                0,
                0,
                0,
                0,
                size * pulseScale,
            );
            gradient.addColorStop(0, `rgba(255, 0, 0, ${intensity})`);
            gradient.addColorStop(0.5, `rgba(255, 100, 0, ${intensity * 0.7})`);
            gradient.addColorStop(1, "rgba(255, 0, 0, 0)");

            warningCtx.fillStyle = gradient;
            warningCtx.beginPath();
            warningCtx.arc(0, 0, size * pulseScale, 0, Math.PI * 2);
            warningCtx.fill();

            // 矢印を描画
            warningCtx.fillStyle = `rgba(255, 50, 50, ${intensity})`;
            warningCtx.strokeStyle = `rgba(255, 255, 255, ${intensity})`;
            warningCtx.lineWidth = 2;
            warningCtx.beginPath();
            warningCtx.moveTo(size * 0.6, 0);
            warningCtx.lineTo(-size * 0.3, -size * 0.4);
            warningCtx.lineTo(-size * 0.3, size * 0.4);
            warningCtx.closePath();
            warningCtx.fill();
            warningCtx.stroke();

            warningCtx.restore();

            // 距離表示（近い場合のみ）
            if (distance < 2) {
                warningCtx.fillStyle = `rgba(255, 255, 255, ${intensity})`;
                warningCtx.font = "bold 14px Arial";
                warningCtx.textAlign = "center";
                warningCtx.fillText(`${distance.toFixed(1)}m`, x, y + 35);
            }
        }
    });
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
    // 選択されたモードの設定を適用
    const mode = gameModes[gameState.gameMode];
    gameState.score = 0;
    gameState.hp = mode.hp;
    gameState.timeLeft = mode.time;
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
    const mode = gameModes[gameState.gameMode];
    const spawnInterval = setInterval(() => {
        if (!gameState.isPlaying) {
            clearInterval(spawnInterval);
            return;
        }

        createEnemy();
    }, mode.spawnInterval); // モードに応じた間隔で敵生成
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

    // 360度ランダムな方向に配置（四方八方から出現）
    const angle = Math.random() * Math.PI * 2; // 0〜360度
    const distance = 2.0 + Math.random() * 2.0; // 2〜4m先
    const verticalOffset = -0.5 + Math.random() * 1.0; // 視線付近±50cm

    // 水平面上でランダムな方向に配置
    const offsetX = Math.cos(angle) * distance;
    const offsetZ = Math.sin(angle) * distance;

    enemy.position.set(
        cameraPos.x + offsetX,
        cameraPos.y + verticalOffset,
        cameraPos.z + offsetZ,
    );

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
            // モード選択画面を表示
            if (modeSelect3DGroup) {
                modeSelect3DGroup.visible = true;
            }
            return;
        }
    }

    // モード選択は弾丸でのみ選択可能（トリガーでの直接選択は無効）
    // モード選択画面では弾を打って選択

    // リスタートボタンのチェック
    if (
        restartButton3D && restartButton3D.parent && gameOver3DGroup &&
        gameOver3DGroup.visible
    ) {
        const raycaster = new THREE.Raycaster();
        const tempMatrix = new THREE.Matrix4();
        tempMatrix.identity().extractRotation(sourceController.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(
            sourceController.matrixWorld,
        );
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

        const buttonIntersects = raycaster.intersectObject(
            restartButton3D,
            true,
        );
        if (buttonIntersects.length > 0) {
            console.log("リスタートボタンがクリックされました");
            // ゲームオーバー画面を非表示
            gameOver3DGroup.visible = false;
            // モード選択画面を表示
            if (modeSelect3DGroup) {
                modeSelect3DGroup.visible = true;
            }

            // バイブレーション
            if (navigator.vibrate) {
                navigator.vibrate(100);
            }
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

    // 銃声SEを再生
    if (shotSound) {
        shotSound.currentTime = 0; // 最初から再生
        shotSound.play().catch((e) => console.log("音声再生エラー:", e));
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
            // モード選択画面を表示
            if (modeSelect3DGroup) {
                modeSelect3DGroup.visible = true;
            }
            return;
        }
    }

    // モード選択は弾丸でのみ選択可能（タップでの直接選択は無効）
    // モード選択画面では弾を打って選択

    // リスタートボタンのチェック
    if (
        restartButton3D && restartButton3D.parent && gameOver3DGroup &&
        gameOver3DGroup.visible
    ) {
        const buttonIntersects = raycaster.intersectObject(
            restartButton3D,
            true,
        );
        if (buttonIntersects.length > 0) {
            console.log("リスタートボタンがクリックされました（タップ）");
            gameOver3DGroup.visible = false;
            // モード選択画面を表示
            if (modeSelect3DGroup) {
                modeSelect3DGroup.visible = true;
            }
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

    // 銃声SEを再生
    if (shotSound) {
        shotSound.currentTime = 0; // 最初から再生
        shotSound.play().catch((e) => console.log("音声再生エラー:", e));
    }

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

    // 3D UIも更新
    update3DUIText();
}

// ゲーム終了
function endGame() {
    gameState.isPlaying = false;

    // 現在のモードでスコアを保存
    saveScore(gameState.score, gameState.gameMode);

    // 全ての敵を削除
    gameState.enemies.forEach((enemy) => scene.remove(enemy));
    gameState.enemies = [];

    // 3D警告インジケーターを非表示
    warningIndicators.forEach((indicator) => indicator.visible = false);

    // 全ての弾丸を削除
    gameState.bullets.forEach((bullet) => {
        if (bullet.userData.body) {
            world.removeRigidBody(bullet.userData.body);
        }
        scene.remove(bullet);
    });
    gameState.bullets = [];

    // 3Dゲームオーバー画面を表示
    if (gameOver3DGroup) {
        gameOver3DGroup.visible = true;
        update3DGameOverScore(gameState.score);
    }

    // 2D UIは非表示（AR空間内で完結）
    gameUI.style.display = "none";
    // gameOverScreen.style.display = "flex"; // 2D画面は使わない
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

    // 視界外警告の描画（2D）
    drawOffScreenWarnings();

    // AR空間での3D警告インジケーターの更新
    update3DWarningIndicators();

    // 3D HUDの更新
    update3DHUD();

    // 3Dモード選択画面の更新
    update3DModeSelectScreen();

    // 3Dゲームオーバー画面の更新
    update3DGameOverScreen(); // ARヒットテストの処理
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

                // モード選択画面を表示
                scene.remove(arTitleGroup);
                arTitleGroup = null;
                startButton3D = null;
                if (modeSelect3DGroup) {
                    modeSelect3DGroup.visible = true;
                }

                // バイブレーション
                if (navigator.vibrate) {
                    navigator.vibrate(100);
                }
                return;
            }
        }

        // モード選択ボタンとの衝突判定
        if (
            modeButtons && modeButtons.length > 0 && modeSelect3DGroup &&
            modeSelect3DGroup.visible
        ) {
            modeButtons.forEach((button) => {
                const buttonWorldPos = new THREE.Vector3();
                button.getWorldPosition(buttonWorldPos);
                const distanceToButton = bullet.position.distanceTo(
                    buttonWorldPos,
                );

                if (distanceToButton < 0.5) {
                    console.log("弾丸がモードボタンに命中！");
                    const selectedMode = button.userData.mode;
                    console.log(
                        `モード「${
                            gameModes[selectedMode].name
                        }」が選択されました`,
                    );

                    // 弾丸を削除
                    if (bullet.userData.body) {
                        world.removeRigidBody(bullet.userData.body);
                    }
                    scene.remove(bullet);
                    gameState.bullets = gameState.bullets.filter((b) =>
                        b !== bullet
                    );

                    // モードを設定してゲーム開始
                    gameState.gameMode = selectedMode;
                    modeSelect3DGroup.visible = false;
                    gameUI.style.display = "block";
                    startGame();

                    // バイブレーション
                    if (navigator.vibrate) {
                        navigator.vibrate(100);
                    }
                    return;
                }
            });
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

                    // ヒットSEを再生
                    if (hitSound) {
                        hitSound.currentTime = 0;
                        hitSound.play().catch((e) =>
                            console.log("ヒット音再生エラー:", e)
                        );
                    }

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

                // ダメージSEを再生
                if (damageSound) {
                    damageSound.currentTime = 0;
                    damageSound.play().catch((e) =>
                        console.log("ダメージ音再生エラー:", e)
                    );
                }

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

    // モード選択画面を表示
    if (modeSelect3DGroup) {
        modeSelect3DGroup.visible = true;
    }
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
