# Rulegen 요구사항 V2 (최신본)

최종 갱신: 2026-10-22 (시작 시 프레임 배치 유지, Live 없앰, overlay handle, 숨은 값의 overlay, property 패널의 제안 파라미터)

`init.md` 원문과 이후 대화에서 요청한 내용을 현재 동작 기준으로 하나로 정리한 문서입니다. 예전 요청 중 지금의 동작과 맞지 않는 내용(visual feature 태그, subfeature·rule widget, Features/Rules/Code/Brush 탭, 프레임 단위 state machine, procedural brush 생성, 스케치와 분리된 generated result 프레임)은 지우고 최신 요구사항으로 덮어썼습니다. 이전 형식 호환은 지원하지 않습니다(19절).

# Overview

Hand-drawn sketch를 creative coding으로 옮기는 과정을 탐색하며 할 수 있도록 돕는 툴이다. 스케치에서 **Collection과 Object**를 추출하고, 그 안의 semantic transformation과 **알고리즘 블록**을 조절·재조합해 p5.js 결과를 만든다.

**Collection은 Brush 메타포를 따른다(22절).** 기능은 같지만 화면에서는 **Brush Stamp**라고 부르고, AI가 만든 Collection은 툴바의 **Brush tool group**이 되어 다른 스케치 프레임에 다시 찍을 수 있다. 각 Brush tool group에는 그 brush만 디버깅하는 **Inspection Tool**, **Inspection Annotation Tool**, **Targeted Inspection Tool**이 들어 있다(23절).

---

## 1. 작업 공간과 프레임 모델

- 작업 공간은 freeform 무한 캔버스다. 캔버스를 이동·확대·축소하고 프레임을 자유롭게 배치한다.
- **프레임은 한 가지 모델(스케치 프레임)뿐이다.** 결과 전용 프레임은 없다. 모든 프레임은 스케치할 수 있고, 자기 장면(Collection·Object)과 그 장면의 **generated result를 같은 프레임 안에** 그린다. 층은 아래부터 생성 결과 → 스케치 획과 레이어 박스 → (annotation 중이면) annotation이다.
- 직접 스케치하는 입력과 사진 첨부(파일 업로드, 드롭, 클립보드 이미지 붙여넣기)를 지원한다. 스케치 프레임 배경은 흰색이다.
- 기본 스케치 도구: 연필(색·굵기·투명도), 지우개, 라쏘, 이동(pan), 확대·축소, Undo/Redo.
- 프레임 헤더에서 프레임마다 결과를 제어한다: **Run / Pause**(애니메이션·상태 머신 재생과 정지), **Re-render**(처음부터 다시 그리기), **Generate / Update**(코드가 없거나 구조가 바뀐 경우), **Annotate**, **Extract**.
- **Interaction은 Brush 도구의 기능이다**(프레임 헤더에 따로 Interact 버튼은 없다). Brush 도구를 고른 채 그 brush가 있는 활성 프레임에서는 실행 중인 결과만 마우스·터치·키보드 입력을 받는다(프레임 부제에 "playing <brush>"). 그 프레임의 스케치 획, collection/object 박스, 레이어 드롭, 선택·삭제·이동 단축키, 이미지 붙여넣기는 꺼진다. 다른 도구를 고르거나 Esc(선택 도구로 바뀜)로 나온다. 결과 annotation 중이거나 regeneration annotation을 그리는 중에는 꺼진다(22절).
- compose 프롬프트 초안 AI는 같은 형태를 다른 모양으로 다시 그린 것(눌림·hover·드래그 중 모습, 화살표로 이은 전/후)을 별도 collection이 아니라 인터랙션 상태에 따라 모양이 바뀌는 하나의 노드로 해석하도록 지시받는다(compose도 같은 규칙).

## 2. 왼쪽 툴바

- 작업 도구와 캔버스 조작 도구는 왼쪽 툴바에 모은다: 스케치 프레임 추가, 사진 첨부, **Select(V)**, 연필(P), 지우개(E), 라쏘(L), 이동(H), 알고리즘 펜·Interaction pen, Undo/Redo/지우기, 확대·축소.
- 연필의 색상·굵기·투명도 메뉴는 연필을 눌렀을 때만 연필 버튼 옆 팝오버로 나타난다.
- Select 도구로 스케치 위의 Collection·Object를 선택하고 움직인다(6절).
- 펜 아래에는 brush가 몇 개든 **Brush 도구 버튼 하나**만 놓인다(22절). 버튼은 지금 쓰는 brush의 색 점과 마지막으로 고른 도구의 아이콘을 보여준다.

## 3. Collection · Object 모델

### Collection
- Figma나 PowerPoint의 Group처럼 여러 Object와 다른 Collection을 묶는다. 묶인 노드는 같이 선택되고 같이 움직인다.
- Group과 달리 **semantic transformation**을 가진다. 하나의 Collection에 semantic transformation을 **여러 개 쌓을 수 있다**(3.1). 각 transformation의 property에 따라 멤버 전체에 spatial(위치·배치·크기·분기), stylistic(색·굵기·질감), temporal(속도·타이밍·성장) effect가 적용된다.
- Collection 안에 Collection을 넣을 수 있고, 루트를 1로 세어 **최대 5단계**까지 중첩한다(예: 나무 → 수관 → 가지 무리 → 잎). Collection 영역은 자기 영역과 멤버를 모두 감싼다.
- **쪼개는 기준**: 공통점(같은 primitive·생김새·동작)이 분명한 부분들은 크기·각도·색·위치가 달라도 **하나의 Object로 유지**하고, 차이는 그 Object의 잘게 쪼갠 transformation으로 표현한다(예: 한 나무의 가지 획들, 두 눈 → Mirror pair, 무지개 띠 → Band color ramp). 단순한 마크·도형도 Object 하나다. **종류가 확실히 다른** 부분들로 된 큰 덩어리만 nested collection(전체 → 부분 묶음 → 부분)으로 만들고, 그 안의 각 부분은 통째로 Object로 둔다. 단계마다 자기 transformation을 가진다.
- AI가 5단계보다 깊게 주면 넘친 노드를 4단계 조상 아래로 끌어올린다. 레이어 편집(그룹, 다른 Collection으로 넣기)이 5단계를 넘기면 거부하고 안내한다.

### Object
- 가장 기본적인 primitive(획, 도형, 점, 곡선 등)다.
- Collection처럼 여러 semantic transformation과 그 property를 가진다.
- Collection 안에 포함되거나 루트에 단독으로 배치된다.

### 3.1 Semantic transformation 스택
- 노드(Collection·Object)마다 semantic transformation을 **순서 있는 목록**으로 가진다(노드당 최대 12개, AI 응답은 10개). 위에서 아래 순서(배치 → 형태 → 변화 → 스타일 → 움직임)로 적용되고, 뒤의 것은 앞의 결과 위에 쌓인다.
- **최대한 잘게 쪼갠다**: transformation 하나는 하나의 semantic 동작이고 이름도 동작으로 짓는다(예: Radial bloom, Petal size falloff, Petal curl, Hue drift by petal, Wind sway). 보통 property 1~3개다. spatial / stylistic / temporal 같은 effect 종류별로 묶거나 "Spatial", "Style", "Temporal", "Color", "Layout", "Motion" 같은 범주 이름을 붙이지 않는다(effect는 property의 태그일 뿐이다). 풍부한 노드는 보통 3~8개, 단순한 노드는 1~2개를 가진다.
- 각 transformation은 고유 id, 이름, 설명, property 목록(최대 8개)을 가진다. 반복(`count` + 배치 블록)도 하나의 transformation으로 둔다.
- Property id는 노드 전체에서 고유하다(노드당 property 최대 32개). 그래서 라이브 키는 transformation과 무관하게 `nodeId/propertyId…`이고, state machine 값도 property id만으로 가리킨다.
- 우측 패널에서 transformation을 추가(빈 것 또는 **Add transformation with AI**), 이름·설명 수정, ↑↓로 순서 변경, AI로 다시 만들기, 삭제(그 property와 상태 값도 함께 삭제)할 수 있다. 블록은 원하는 transformation의 소켓에 끼우거나 드롭한다. 상태 편집 중에는 스택 구조를 바꿀 수 없다.
- transformation 카드의 **Create Minimal Example**은 그 transformation 하나만 시험해 보는 새 sketch frame을 옆에 만든다. 특수한 프레임이 아니라 일반 sketch frame이고, 안에는 collection 하나와 object 하나만 들어간다. collection의 transformation이면 그 collection에 그 transformation만 남기고 구성원 하나를 transformation 없는 평범한 object로 넣는다(구성원이 없으면 빈 object를 만든다). object의 transformation이면 그 object에 그 transformation만 남겨 평범한 collection 안에 넣는다. 상태 머신은 빼고, 쓰는 알고리즘만 가져오며, 프레임 가운데에 배치한 뒤 바로 결과를 생성한다. 코드 생성은 "이 transformation만 보이게 단순하게 그려라"는 지시와 그 프레임 자체 스케치로 한다. 이 지시는 첫 생성뿐 아니라 이후 Update·오류 수정 때도 계속 붙는다(전에는 첫 생성에만 붙어서, 다시 생성하면 원래 brush 동작이 통째로 돌아왔다). 입력에 관한 transformation(드래그하면 생김, 손 떼면 고정, 포인터 따라감 등)만 interaction을 유지하고, 나머지는 입력 없이 처음부터 화면에 떠 있어야 한다. 원래 brush가 입력 경로로 만들던 것(드래그를 따라가는 trail 등)은 코드 안에 정한 샘플 경로로 대신 그린다.
- 프레임 위쪽 메뉴의 **Decompose**는 그 프레임 base state(상태 머신 값이 아닌 원래 정의)의 모든 노드, 모든 semantic transformation(property가 있는 것)에 대해 위와 같은 최소 예제 프레임을 한꺼번에 만든다. 화면은 원래 프레임에 그대로 두고, 예제 프레임들의 결과는 서버가 한 번에 받는 만큼(2개씩) 나눠 생성하고, 서버가 바빠 거절한 요청은 잠시 기다렸다가 다시 보낸다(하나씩 만든 예제도 같음). 프레임 수 한도(24개)를 넘는 것은 만들지 않고 몇 개가 빠졌는지 알려준다.
- 최소 예제 프레임(하나씩 만든 것이든 Decompose로 만든 것이든)은 원래 프레임과 점선 화살표로 연결되고, 선에는 「▣ transformation 이름」이 붙는다. 프레임 부제에도 `example of <원래 프레임>`이 보이며, 이 연결은 프로젝트에 저장된다. 원래 프레임을 지우면 선만 사라지고 예제 프레임은 남는다.
  - 만든 예제는 interact가 필요하든 아니든 모두 **sub brush**로 추가된다(Create Minimal Example, Decompose 둘 다). 그 transformation이 속한 source brush(그 brush가 sub brush라면 그 부모)의 tool group 안에 들어가고, 툴바에 그룹 버튼이 따로 생기지 않는다. 원래 프레임에 brush 표시가 없으면(예: brush를 추출해 낸 원본 스케치) 그 노드 root의 code id가 같은 brush의 그룹을 찾는다. 어느 brush와도 이어지지 않을 때만 독립된 brush가 된다. 입력에 반응하는 transformation이면 예제 코드도 그 interaction을 그대로 유지하도록 지시한다.
    - 그룹 패널의 **SUB BRUSHES**에 sub brush마다 Brush 도구와 Inspection 도구가 있다. 이름 기본값은 "<transformation> · example"이고, 색은 부모와 같으며, ×로 지운다.
    - Brush 도구로 다른 프레임에 칠하면 추가되거나 interaction으로 동작하고, Inspection으로 검사할 수 있다. 일반 brush와 같다.
    - 예제 프레임의 collection이 그 sub brush의 master다. sub brush 도구를 쓰는 동안 Brush 버튼 제목은 "Brush · 부모 › sub brush · 도구"이다.
- **최소 예제 다시 분해하기 (2026-10-30)**: 최소 예제 프레임(transformation이 하나뿐인 example)에서 **Decompose**를 누르면 새 AI 요청 `split`(`prompts/split.md`)이 그 transformation을 코드가 실제로 돌리는 의미 있는 내부 알고리즘 2–5개로 나눈다. 코드에 상수로 박혀 있던 값도 그 알고리즘의 property(constraint)가 된다.
  - 부모 예제 프레임은 그대로 둔다. 나뉜 알고리즘마다 그것 하나만 담은 **자식 예제 프레임**이 생기고 부모 예제와 선으로 연결된다(선 이름은 자식이 가진 transformation 이름). 자식에서 그 알고리즘의 constraint만 조절한다. 자식도 sub brush가 되고, 자식에서 다시 Decompose할 수 있다.
  - 더 나눌 의미가 없으면(알고리즘 하나뿐이면) 프레임을 만들지 않고 "더 쪼갤 수 없습니다: <이유>" 토스트가 뜬다. 나뉜 조각이 2개 미만이어도 같다.
- **semantic pen을 곧이곧대로 해석하지 않기 (2026-10-30)**: `prompts/contracts/pen-interpretation.md`를 compose-prompt와 compose 프롬프트에 함께 넣었다. 예전에는 펜 알고리즘을 같은 id·같은 값으로 복사해 원래 쓰이던 양에 그대로 적용하라고 했다.
  - 이제 펜 알고리즘을 **패턴**(양을 어떻게 바꾸는지)과 **출처**(원래 어떤 양을 바꿨는지)로 나눠 본다. 출처는 힌트일 뿐이고, 스케치에서 그 자국을 따라 실제로 무엇이 바뀌는지 보고 패턴이 바꿀 양을 다시 정한다(re-target).
  - 서로 다른 펜 자국이 겹치거나 같은 형태 위에 있으면 하나의 의도로 함께 읽는다. 보통 하나가 형태나 효과이고, 다른 하나가 그 효과의 정도·빠르기·밀도·퍼짐을 자국 순서를 따라 조절한다.
  - 스케치가 보여 주지 않는 변화(그린 크기가 같은데 크기 바꾸기 등)에는 적용하지 않는다.
  - 알고리즘의 식과 파라미터 의미는 지키고, 적용 대상·방향·범위·값을 스케치에 맞춘다. 그대로 쓰면 같은 id, 범위나 단위가 달라지면 새 id의 수정본을 쓴다.
  - transformation 펜도 시작점으로만 쓴다. 어느 노드에 넣을지, 어떤 property가 중요한지와 그 값은 스케치에 맞추고, 스케치가 보여 주지 않는 property는 뺀다.
  - instruction이나 사용자가 적은 펜 의미가 대상을 분명히 말하면 그것을 따른다. 모호하면 모든 펜이 하나의 일관된 변화에 기여하는 해석을 고르고, 그 해석을 말로 적는다.
  - Compose prompt 초안에는 펜 이름이나 출처가 아니라, 해석한 결과(어느 형태의 어떤 양이 어떻게 바뀌는지)를 적는다.
- **Recommendation 프레임: 멈췄다가 마저 생성, preview에서 고치기 (2026-10-30)**
  - Inspection이 끝나면 recommendation마다 프레임 그룹(fork 자리 · Execution · 핵심 파라미터)은 바로 만들지만 **내용은 만들지 않는다**. Execution·핵심 파라미터 프레임은 "아직 만들지 않았습니다" 상태로 멈춰 있다. fork 프레임 아래 **▶ 마저 생성**을 누르면 둘을 AI로 만들고, 각 프레임의 **생성** 버튼으로 하나씩 만들 수도 있다. 원인(cause) 프레임은 예전처럼 inspection과 함께 만든다.
    - 마저 생성 전에도 inspection preview가 있으면 그 코드로 Accept할 수 있다. 없으면 "「마저 생성」으로 … 만들면 Accept할 수 있습니다"라고 알린다.
  - **바뀌는 곳 표시**: recommendation preview에 AI가 `marks`(1–3개)를 함께 만든다. 바뀐 부분 위에 원·사각형·선과 짧은 이름("윤곽 하나로", "새로 생김")을 그린다. overlay와 같은 수식(`p`, `s`, `item`, `each`)으로, preview 코드가 그린 store를 읽는다. 패널의 작은 preview와 fork 프레임 모두에 보인다. preview 규칙은 `prompts/contracts/recommendation-preview.md`로 옮겨 inspect-preview와 revise에 함께 넣었다.
  - **preview 손잡이**: AI가 recommendation이 기대는 양(얼마나 키울지, 어느 거리부터 겹친 것으로 볼지 등) 0–3개에 overlay 손잡이(`preview.handles`)를 단다. 그 양을 고른 것이 concern에 대한 AI의 이해이므로, 사용자가 손으로 고칠 수 있게 한 것이다. 끌면 fork 프레임의 preview가 그 값으로 다시 그려진다. 키는 brush 값이나 preview가 가져온 값만 쓴다(실행 상태 키는 서버에서 뺀다). 바꾼 값은 메뉴에 목록으로 보이고 ×로 되돌린다. Accept하면 그 값으로 fork를 만든다. preview 값은 시작값이 되고, brush 값은 fork에 적용한다.
  - fork 프레임 안에 있던 메뉴(Accept 등)를 **프레임 밑**으로 내렸다.
  - **Preview에서 recommendation 고치기**: 메뉴 아래 "PREVIEW에서 고치기"에서 다음을 한다.
    - **크롭 · 이동 · 크기 · 회전 (기본 도구)**: 따로 켜지 않아도 처음부터 쓸 수 있다. 바꿀 부분을 **자유롭게 둘러 그리면**(freeform 크롭) 그 안의 그림이 잘려 나온다.
      - 크롭을 끌면 옮겨지고, 모서리 □로 크기를, 위의 ○로 회전을 바꾼다(중심 기준). Esc로 선택을 푼다.
      - 잘린 그림은 새 자리에 실제로 옮겨져 보이고, 원래 자리에는 점선 외곽선이 남는다. 크롭은 외곽선 안을 눌러야 잡힌다.
      - 앱이 물체를 정하지 않는다. 예전의 store 항목·그림 조각·사각형 영역으로 고르던 방식은 없앴다. 무엇을 크롭했는지는 AI가 그림에서 읽는다.
      - AI에는 크롭 외곽선(점 목록)·상자·이동·배율·회전과, 잘린 그림을 옮겨 그린 이미지를 보낸다.
      - preview 손잡이는 이 조작 층 위에 있어 그대로 끌 수 있다.
    - **Annotation**: 켜면 preview 위에 그린다. 다시 누르면 선택 도구로 돌아간다.
    - preview 손잡이로 값을 바꾸고, 메모를 적는다.
    - **Revise recommendation**을 누르면 새 AI 요청 `revise-recommendation`(`prompts/revise-recommendation.md`)이 같은 recommendation을 고친다(제목·설명·종류·preview 코드·marks·handles). 이때 받는 것: preview 그림(조작 결과와 annotation을 그려 넣은 것), 조작 목록(원래 상자·이동·배율·회전), 바꾼 값(전→후), 메모, concern. 조작은 그 물체 하나가 아니라 같은 역할의 물체 모두에 대한 규칙의 시연으로 읽는다.
    - 고친 recommendation은 targeted 도구의 그 항목을 바꾸고(shared id로 저장), fork 자리의 제목·그룹 이름이 바뀐다. Execution·핵심 파라미터 프레임은 옛 recommendation을 읽고 있었으므로 다시 "만들지 않음" 상태가 된다.
    - preview 코드가 적용되지 않거나 대상이 brush 밖이면 아무것도 바꾸지 않고 오류를 보인다. 요청 중에는 취소할 수 있다.
- **Execution이 속한 곳 표시 (2026-10-31)**: Execution 프레임을 만들 때 AI가 그 execution 전체(`of`)와 연산 종류(`stages[].of`)마다 brush의 어느 semantic transformation · state · transition에 속하는지 함께 적는다(`prompts/explore.md`). 서버는 brush에 없는 것을 빼고(미리보기가 가져오는 state·transition은 둠), 전체 목록에 연산들 것을 합쳐 중복을 없앤다. 프레임 아래 메뉴에 "이 execution이 속한 곳: Transformation 「…」 · State 「…」"가, 방금 실행/다음 단계 줄에는 그 연산이 속한 곳이 작은 칩으로 보인다. 연산 버튼의 툴팁에도 나온다.
- **속한 곳 칩을 누르면 패널에서 보기 (2026-10-31)**: Execution 프레임의 "이 execution이 속한 곳"·단계 줄의 칩은 버튼이다. 누르면 그 프레임과 targeted 도구가 현재 것이 되고, 그 노드가 선택된다. Transformation이면 오른쪽 properties 패널에서 그 transformation 카드가 강조되고 그 자리로 스크롤된다. State·Transition이면 아래 state machine 패널에서 강조(첨부)되고, 그래프가 그 state(transition이면 양 끝 state)가 보이게 이동한다.
- **확대해도 선명하게 (2026-10-31)**: 보드(`.world-layer`)에 늘 걸려 있던 `will-change: transform` 때문에 브라우저가 보드를 한 장의 그림으로 굳혀 확대할 때 늘렸다. 그래서 글자·버튼·선이 흐려졌다. 이제 보드를 끄는 동안에만 걸어서, 멈추면 그 배율로 다시 선명하게 그린다. state machine 그래프도 같은 이유로 뺐다. p5 결과 그림 자체는 900×600 캔버스(화면 배율만큼)라 크게 확대하면 여전히 부드러워진다.
- **탐색 프레임·fork 자리·프레임 그룹 저장 (2026-10-31)**: Execution · 핵심 파라미터 프레임과 recommendation의 fork 자리를 프로젝트와 함께 저장한다(`exploreFrames`, `forkSlots`; 위치와 프레임 그룹도). 예전에는 저장하지 않아 새로고침하면 그룹이 fork만 남기고 사라졌다.
  - 탐색 프레임은 AI가 만든 결과·실행 위치·끌어 본 값·요청 문맥·잡고 있던 brush 자국을 저장한다. 기록된 단계들은 단계를 오가는 프레임일 때만 저장한다.
  - 돌릴 프로그램은 저장하지 않는다. 불러온 뒤 원래 프레임의 결과가 준비되면 다시 만든다(추천 미리보기 코드도 넣어서).
  - 만드는 중이던 프레임은 "아직 만들지 않음"으로 돌아온다. 크롭·annotation 같은 표시 중인 것은 저장하지 않는다.
  - 원래 프레임이 없어진 것은 버린다. 읽을 수 없는 항목 하나는 빼고 나머지 프로젝트는 불러온다.
  - fork 자리는 제목·설명·어느 recommendation인지만 저장한다(바뀐 버전은 다시 읽는다).
  - 저장 공간(localStorage)이 차면 예전처럼 "Storage full · export JSON"이 뜬다.
- **Execution: 누른 곳으로 이동 (2026-10-31)**: 단계별 실행 줄에 **◎ 누른 곳으로** 모드를 더했다. 켜고 그림의 한 부분을 누르면 그 부분을 그리는 단계까지 실행한다(그 단계까지 그려진 모습). 같은 곳을 다시 누르면 거기를 그리는 다음 단계로 가고, 마지막 다음에는 처음으로 돌아간다(예: 원래 하트 → 합친 하트). 포인터 아래에는 갈 곳의 상자와 "단계 n/전체 · 단계 이름 · 연산"이 보인다. 단계는 실행 기록의 그리기 호출과 체크포인트 상자로 찾는다. 누른 점을 담는 것 중 가장 작은 것을 쓰고, 없으면 30px 안의 가장 가까운 것을 쓴다. 캔버스를 거의 덮는 배경은 뺀다(`stepsAt`, `jumpTarget`). 크롭·Annotation을 고르면 꺼지고, Esc로도 끈다.
- **기록된 단계가 없는 프레임의 targeted inspection (2026-10-31)**: inspection 단계 기록(`panel.inspections`)과 fork의 시작 상태(`seed`)는 저장되지 않아서, 새로고침하면 사라진다. 단계가 없으면 원인 Execution 프레임과 recommendation 프레임 그룹을 만들 수 없는데, 그 이유를 알리는 토스트가 inspection 완료 토스트에 덮여 아무 일도 없는 것처럼 보였다. 이제 targeted inspection을 시작할 때 그 brush의 단계가 없으면, 실행 중인 결과에 지금 모습을 단계로 보고하게 하고(`CodePreviewHandle.snapshot`) 그 단계로 inspect한다. 그래도 단계가 없으면 완료 토스트에 왜 프레임을 못 만들었는지와 어떻게 하면 되는지를 붙인다.
- **canvas에 직접 그리는 brush도 Execution 단계별로 (2026-10-31)**: 예전에는 실행 단계 제한이 p5 그리기 호출(`p.ellipse`, `p.line` 등)만 잘랐다. 그래서 `p.drawingContext`(ctx)에 `beginPath … stroke()`로 직접 그리는 brush(예: 손그림 하트)는 몇 단계든 다 그려져 그림이 단계마다 바뀌지 않았다. 이제 실행을 기록할 때 그 context의 그리는 호출(`fill`, `stroke`, `fillRect`, `strokeRect`, `fillText`, `strokeText`, `drawImage`)도 실행의 사건으로 세고, 그 단계 뒤의 것은 그리지 않는다. 사건의 위치는 그 전에 만든 경로(`moveTo`, `lineTo`, `bezierCurveTo`, `arc` 등)의 상자다. `p.background`·`p.clear`는 단계로 세지 않는다. 생성 코드 샌드박스가 `prototype`을 막아서 context 객체 자체의 메서드를 실행 시작 때 한 번 감싼다.
- **Execution 프레임에서 보여주고 recommendation 만들기 (2026-10-31)**
  - Execution 조절해보기 프레임 아래 메뉴에 "이 실행 순간에 보여주고 RECOMMENDATION 만들기"가 생겼다(원인 프레임과 recommendation 그룹의 Execution 프레임 모두).
  - 도구는 셋이다.
    - **실행 손잡이** (처음 상태): 예전처럼 손잡이·단계 버튼으로 실행을 앞뒤로 움직인다. 표시한 것은 그림 위에 보이기만 하고 포인터를 막지 않는다.
    - **크롭 · 이동 · 크기 · 회전**: fork preview와 같은 freeform 크롭. 둘러 그려 자르고, 끌어서 옮기고, □로 크기, ○로 회전.
    - **Annotation**: 그림 위에 그린다.
  - 표시는 **그 실행 순간**(단계 n/전체, 또는 진행 %)에 묶인다. 다른 순간으로 가면 그려지지 않고, 메뉴에 "단계 3/8에서 표시한 내용이 있습니다 · 그 순간으로 · 지우기"가 뜬다. 크롭과 annotation은 처음 표시할 때의 그림에서 잘라 낸다.
  - **Recommendation 만들기**를 누르면 새 AI 요청 `execution-recommendation`(`prompts/execution-recommendation.md`)이 recommendation 하나를 새로 만든다(종류·대상·제목·설명·preview 코드·marks·handles).
    - AI가 받는 것: 그 순간의 그림(크롭 결과와 annotation을 그려 넣은 것), 크롭 목록, 메모, concern, inspection 요약, 그 순간(지금 단계·방금 실행한 단계·다음 단계·연산 종류와 설명), 프레임이 보여주는 recommendation(있으면, 적용 여부와 함께), 이미 있는 recommendation 제목.
    - 표시한 실행 순간의 연산이 바뀌어야 할 곳으로 읽게 했다. 프레임이 아직 적용하지 않은 recommendation을 보여주고 있으면 그것을 보여준 대로 고친 새 버전을 만든다.
  - 만든 recommendation은 targeted 도구 목록 끝에 붙고(shared id로 저장, 도구당 최대 12개, `MAX_LISTED_RECOMMENDATIONS`), 바로 옆에 자기 프레임 그룹(fork 자리 · Execution · 핵심 파라미터, 내용은 「마저 생성」으로)이 생기며 fork 자리로 이동한다. Execution 프레임의 표시는 지워지고 AI의 한 줄 답이 남는다.
  - preview 코드가 적용되지 않거나 대상이 brush 밖이면 아무것도 더하지 않고 오류를 보인다. 요청 중에는 취소할 수 있다. Execution 프레임을 다시 만들면 표시도 지워진다.
  - 크롭·annotation 층과 도구 버튼은 `app/components/picture-edit.tsx`로 빼서 fork 자리와 Execution 프레임이 같이 쓴다. revise와 새 요청의 결과 검증도 서버에서 한 함수(`settledRecommendation`)로 같이 쓴다. 이때 add-transformation이 노드의 transformation 한도를 넘으면 거부하는 검사가 revise에도 들어갔다.
- **배경은 Decompose하지 않음 (2026-10-30)**: 캔버스를 다 덮는 정지 배경 object(예: Quiet background의 "Paper fill")는 brush가 아니므로 Decompose 대상에서 빠진다. 예전에는 그 예제가 들어갈 brush group이 없어서 **독립 brush**("Paper fill · example")로 생겼고, Decompose할 때마다 다시 생겼다. 이제 sub brush는 그 노드가 속한 brush group 안에만 만들고, 없으면 만들지 않는다(그런 예제에는 Sub brush 버튼도 없음). 이미 생긴 그런 brush(부모 없음·fork 아님·예제 프레임이 master·이름이 " · example")는 열 때 자동으로 지우고 토스트로 알린다.
- **스케치 프레임 최대 60개 (2026-10-30)**: 24개에서 60개로 늘렸다(`MAX_SKETCH_FRAMES`, 저장 형식·새 프레임·fork·예제 생성 모두). 탐색 프레임(16개)과 proxy frame(24개) 한도는 따로다.
- **예제 프레임 헤더 버튼 (2026-10-30)**
  - **Sub brush**: 이 예제의 sub brush를 Brush 도구로 고른다(쓰는 중이면 눌린 상태). sub brush가 없으면(예전 예제 등) 먼저 원래 brush의 tool group에 만든다.
  - **Make pen**: 이 예제가 담은 transformation(label, 설명, property와 값, 쓰는 algorithm)을 담은 **transformation 펜**을 툴바에 추가한다(AI 없음). 이 펜으로 그린 자국은 Compose할 때 그 자국이 그리는 노드에 이 transformation이 그대로 들어가도록 AI에 전달된다(`prompts/compose.md`, `compose-prompt.md`). 펜 설정에는 TRANSFORMATION과 property 값이 보인다.
  - **Hide**: 예제 프레임을 보드에서 숨긴다. 프레임과 연결선이 사라지고 p5 결과도 멈춘다(렌더하지 않음). 숨긴 목록은 레이아웃과 함께 저장된다. 원래 프레임 헤더에 **Examples n개 보이기**가 생겨 누르면 다시 보인다(그 프레임에서 나온 예제와, 그 예제를 다시 분해한 예제까지 모두).
  - **Hide all examples**: 예제를 만든 원래 프레임(예제를 다시 분해한 예제 프레임도) 헤더에 있다. 그 프레임에서 나온 예제와 그 아래 자식 예제를 한꺼번에 숨긴다. 숨길 예제가 하나도 없으면 버튼이 없다. 원래 프레임이 없어지면 숨긴 예제는 저절로 다시 보인다.
    - 부모 brush를 지우면 sub brush도 함께 지워진다.
- Layers의 노드 배지는 transformation 수를 보여주고, 툴팁에 적용 순서를 표시한다.

### Property
- Property는 이름과 effect(spatial / stylistic / temporal)를 가진 **소켓**이다. 소켓에는 숫자(슬라이더)·색·선택·토글 같은 값이나 **알고리즘 블록**이 들어간다(4절).
- 숫자는 슬라이더와 입력칸으로 조절하며 단계·범위를 지킨다.

## 4. 알고리즘 블록과 property 소켓

- 알고리즘은 property에 종속되지 않은 독립된 **블록**이다. 스케치별 **블록 팔레트**(알고리즘 라이브러리)에 한 번 정의되고, 어떤 property 소켓에도 끼울 수 있다. 같은 블록을 여러 property·노드·다른 블록의 파라미터에 동시에 쓸 수 있다.
- 블록은 알고리즘마다 고유한 색을 가지며, 어디에 끼워져도 같은 색과 모양으로 보인다. 소켓은 점선 슬롯으로, 블록을 끌어오면 강조된다.
- 블록의 파라미터도 소켓이다. 숫자가 들어가거나 다른 블록이 들어간다(예: 재귀 분기 블록의 `length` 소켓에 power decay 블록). 최대 4단계까지 중첩하고, 자기 자신을 기본값으로 참조하는 정의는 거부한다.
- 블록을 끼우는 방법
  - **드래그 앤 드롭**: 팔레트의 블록이나 다른 소켓에 끼워진 블록의 머리를 끌어 숫자/블록 소켓에 놓는다. 끼워진 블록을 끌면 인자 값까지 복사된다.
  - **우클릭 복사·붙여넣기**: 블록을 우클릭(또는 ⋯)해 Copy block → 다른 property·인자 소켓을 우클릭해 Paste. 클립보드는 스튜디오 전체에서 공유되어 다른 스케치에도 붙여넣을 수 있다. 우측 패널 상단에 현재 클립보드 블록을 표시한다.
  - **Swap 메뉴**: 소켓의 선택 메뉴로 Number ↔ 팔레트의 다른 블록으로 바꾼다.
  - **새 소켓**: property 목록 끝의 빈 소켓에 블록을 놓거나 고르면 그 블록을 담은 새 property가 생긴다.
- 블록 정의(이름·설명)는 팔레트에서 고치며, 끼워진 모든 곳에 반영된다. 팔레트는 블록마다 파라미터 기본값과 끼워진 노드를 보여주고, 아무 데도 끼워지지 않은 블록은 대안(alternative)으로 남는다.
- 다른 스케치나 펜의 블록을 의존 블록과 함께 가져올 수 있다. 같은 id에 다른 정의면 이름을 바꿔 충돌을 피하고, 같은 정의면 재사용한다.
- 블록 구조 변경(끼우기·빼기·교체)은 Base에서만 하고, 상태를 편집 중일 때는 값만 바꾼다(9절).
- 블록을 **Make pen**하면 호출 인자와 의존 블록 전체를 담은 semantic pen이 툴바에 추가된다(AI 호출 없음).

## 5. 추출

- **Extract**(프레임 헤더 또는 Layers의 빈 상태)는 전체 이미지 또는 라쏘 영역에서 Collection·Object 트리, 각 노드의 semantic transformation과 property, 블록 팔레트를 만든다.
- 추출 결과는 원본 프레임이 아니라 **원본 옆에 새로 생기는 스케치 프레임**에 담긴다. 새 프레임도 똑같은 스케치 프레임이라 그 위에 다시 스케치할 수 있고, 추출 직후 그 프레임 안에서 결과를 생성해 보여준다(생성 중 표시 후 결과). 원본 스케치는 그대로 남는다. 코드는 원본 스케치 이미지와 획을 문맥으로 생성한다.
- 결과가 있는 프레임에서 Extract하면 보이는 그대로(생성 결과 + 그 위의 획)를 분석한다. 라쏘 영역 좌표는 원본 좌표로 되돌린다.
- **Procedural economy**: Collection·Object를 마구 늘리지 않는다. 노드 수는 마크 수가 아니라 서로 다른 *종류*의 수로 정한다(단순한 마크는 1~2개, 풍부한 이미지는 대개 2~5단계에 걸친 4~15개, AI 응답은 최대 24개). 노드 수는 구조를 평평하게 만들어서가 아니라 반복을 procedural하게 생성해서 줄인다.
  - 공통 특징을 가진 요소(꽃잎, 잎, 점, 벽돌, 가지, 물결, 해칭 선, 흩뿌린 자국 등)는 크기·색·회전·위치가 달라도 **하나의 노드**로 만들고, 그 region이 모든 인스턴스를 덮는다. 반복은 semantic transformation이 **procedural하게 생성**한다: `count` + 배치 알고리즘(row·grid·radial·scatter·along-path·recursive 등) + 인스턴스 번호·깊이·노이즈에 따른 알고리즘 변화(크기는 power-decay, 색은 palette 등).
  - 부분이 있는 반복 단위(꽃 = 꽃잎 + 꽃술)는 Collection 하나로 만들고 그 Collection의 transformation이 복제한다. 종류나 역할이 다르거나, 따로 선택·이동해야 하거나, 자기 state machine이 필요할 때만 노드를 나눈다. 같은 로직은 하나의 블록을 id로 재사용한다.
  - 코드 생성은 한 노드가 여러 인스턴스를 뜻한다는 것을 알고, count·배치 블록으로 모든 인스턴스를 노드 영역 안에 그린다.
- 원본 스케치가 바뀌면 추출된 프레임에 다시 추출하라는 안내를 표시한다. 다시 Extract하면 또 하나의 새 프레임이 생긴다.
- AI 재생성은 세 가지다: property 하나 다시 만들기, transformation 하나를 같은 id로 다시 만들기, 새 transformation을 AI가 제안해 스택 끝에 추가하기. 나머지 값은 유지하고, 겹치는 property id는 자동으로 바꾼다.
- **재생성은 버튼을 눌러도 바로 실행되지 않는다.** property·transformation의 ✦ 버튼이나 Add transformation with AI를 누르면 그 자리에 **Regenerate with AI** 입력 창이 열린다. 무엇이 대상인지(Property / Transformation / New transformation) 첨부 칩으로 보이고, 어떻게 바꿀지(또는 무엇을 더할지) 텍스트로 적는다. **Draw on frame**을 켜면 활성 프레임에 보라색으로 바꿀 곳을 그릴 수 있고(그 동안 스케치 획·레이어 선택은 꺼짐), "Annotation n획 첨부됨"으로 보이며 ×로 지운다. **Regenerate**를 누르면 텍스트(비어 있으면 프레임의 기존 지시), annotation 좌표, annotation을 그린 결과 이미지가 함께 AI(`transform`)에 간다. 성공하면 창이 닫히고, 실패하면 내용이 남아 다시 시도할 수 있다. Cancel로 닫는다. **재생성이 성공하면 그 프레임에 결과 코드가 있을 때 코드도 바로 다시 생성한다**(재생성된 transformation의 새 설명대로 예전 동작을 바꾸라는 지시와 함께). 그래서 장면 설명과 실행 중인 코드가 어긋나지 않고, 그 프레임에서 만든 brush도 새 코드를 쓴다.

## 6. Layers 패널과 직접 조작

- 캔버스 왼쪽에 **Layers 패널**을 둔다. Collection/Object 트리, 이름 변경(더블클릭), 표시/숨김, 다중 선택(Shift/⌘), 드래그로 다른 Collection에 넣기·순서 바꾸기, Group(⌘G)·Ungroup(⇧⌘G)·삭제·위/아래 이동, 새 Collection/Object, 레이어 Undo/Redo를 제공한다.
- 스케치 위에는 Collection(점선)·Object(실선) 영역과 이름 태그를 표시한다. Select 도구로 Figma처럼 처음 클릭하면 바깥 Collection, 다시 클릭하면 한 단계 안쪽이 선택되고, 드래그하면 멤버와 함께 움직인다. 화살표 키로 미세 이동, Delete로 삭제한다.
- **레이어를 다른 스케치 프레임으로 드래그 앤 드롭**하면 그 노드가 멤버·블록·state machine과 함께 놓은 위치에 복사되고, **드롭한 그 프레임 안에서 바로 결과가 생성되어 보인다**(생성 중 표시 → 결과). 대상 프레임에 이미 결과가 있으면 그 구도를 유지하며 새 노드를 더한다. 같은 id가 있으면 이름을 바꾸고, 원본 프레임은 그대로다.
- 같은 프레임 안에서 노드를 움직이면(Select 드래그, 화살표 키, 드롭 위치 이동) **결과가 움직이는 대로 따라간다.** 드래그하는 동안 새 위치 값을 실행 중인 결과에 바로 보내 그 자리에서 다시 그리며(재생성·새로고침 없음), 놓을 때 한 번의 Undo 단계로 기록한다. 코드 생성 시 모든 노드를 위치 키로 배치하도록 지시한다.

## 7. 우측 패널

- 탭 없이 하나의 패널이다(Features/Rules/Code/Brush 탭은 없앤다).
- 위에서부터: AI 진행·오류 표시, 블록 클립보드, Compose 영역, (결과 annotation 중이면) clarification·제안 검토, 라이브 연결 상태와 Generate/Update code, 실행 오류와 Fix with AI, 선택한 노드의 properties(또는 선택 안내), 블록 팔레트, Generation direction.
- 선택한 노드의 이름·설명, state 칩, 상태별 설명과 전이, 그리고 **semantic transformation 스택**(번호가 붙은 카드마다 이름·설명·도구·property 소켓·새 소켓)을 보여준다.

## 8. 코드 생성과 라이브 연결

- Generate code는 장면 전체(노드, transformation 스택, 블록, 머신)를 p5.js 코드로 만든다. 노드의 transformation은 순서대로 적용한다.
- **코드는 처음부터 루트 노드(대부분 Collection)마다 독립된 모듈로 생성된다.** AI는 `rulegenModule("루트 id", function (m) { … return { setup, draw, mousePressed, … } })`만 루트마다 하나씩 쓴다. 알고리즘 함수·도우미·상태는 모두 그 모듈 안에 두고, 모듈끼리는 아무것도 공유하지 않는다(같은 알고리즘도 모듈마다 따로 정의).
  - 모듈은 `m`으로만 장면과 연결된다: `m.v("nodeId/propertyId…")` 값, `m.box("nodeId")` 위치·크기·표시 여부, `m.state("nodeId")` 현재 상태, `m.emit("nodeId", "transitionId")` 이벤트 전이, `m.p` p5. `m.store`는 인스턴스의 상태 객체로, 프레임 사이에 바뀌는 값(위치, 속도, 입자 배열, 잔상 기록 등)은 모두 여기에 일반 데이터로 둔다. 모듈 함수 바로 안에는 함수와 상수만 둘 수 있어서(`let`·배열·객체 금지), 호스트가 단계마다 상태를 저장·복원할 수 있다. 인자는 모두 문자열 리터럴이고 자기 모듈의 노드만 가리킬 수 있다.
  - 캔버스·루프·입력은 호스트가 맡는다: 900×600 캔버스를 만들고 매 프레임 지운 뒤 모듈마다 `draw`를 `push/pop` 안에서 부르고, 마우스·키·터치 입력을 모든 모듈에 나눠 준다. 모듈은 `p.setup`·`p.draw` 등 p의 속성을 바꾸거나 `background`·`createCanvas`·`noLoop` 등을 부를 수 없다.
  - 서버는 코드를 구문 분석해 이 계약을 검사한다(최상위에는 rulegenModule 호출만, 루트마다 정확히 하나, `m` 사용법, 자기 노드의 키·전이만, 모든 property 연결, 선언 안 한 전역 변수 금지). 어기면 거부하고 다시 생성한다.
  - 장면의 루트 노드 하나하나가 모듈의 **인스턴스**다. 인스턴스는 모듈 안의 노드 id를 실제 노드 id로 매핑하므로, 같은 모듈을 다른 노드 id로 여러 번 실행할 수 있다(brush stamp 복사본).
- 모든 scalar(중첩 블록의 인자 포함)는 `m.v("nodeId/propertyId/argId…")` 리터럴로 코드에 연결되어, 슬라이더를 움직이면 AI 호출 없이 결과가 바로 바뀐다. 노드 위치·크기·표시 여부(`m.box`)도 연결되어 레이어를 옮기거나 숨기면 결과도 바뀐다.
- 값만 바뀐 경우(슬라이더, 레이어 이동·숨김, 상태 값, 전이 시간)는 실행 중인 결과에 새 값을 보내 제자리에서 다시 그린다. 프로그램 자체가 바뀔 때만 다시 불러오며, 다시 불러오는 동안에도 이전 그림을 유지해 깜빡이지 않는다.
- 구조가 바뀌면(블록 교체, property 추가·삭제, 머신 변경) 상태가 *Structure changed*로 바뀌고 Update code로 다시 연결한다. 설명만 바뀐 경우도 알려준다.
- 생성 코드는 서버에서 AST로 검사한다: 모든 바인딩 사용, 리터럴 키만 허용, 값·상태 쓰기와 호스트 이름 재선언 금지, 잘못된 이벤트 금지, 머신이 있으면 `p.draw` 유지.
- 코드는 하단 **Raw p5.js** 패널에서 보고 복사·다운로드한다. 편집 버튼으로 코드를 고친 뒤 Run으로 실행하고, 실행 오류는 같은 패널과 우측 패널에서 Fix with AI로 고친다.
- 하단 패널(Code · State Machine · Inspection)은 **위쪽 가장자리를 위아래로 끌어 높이를 조절**한다(↑/↓ 키로도, Shift와 함께 크게). 정한 높이는 세 탭에 똑같이 적용되고 이 브라우저에 기억되며, 더블클릭하면 기본 높이로 돌아간다.
- 생성 코드는 프레임마다 별도 sandbox iframe에서 실행하며 저장소·네트워크 접근이 없고 반복·재귀 실행 한도를 둔다. Pause는 상태 머신과 일반 애니메이션 루프를 모두 멈춘다.

## 9. Collection · Object별 state machine

- State machine은 프레임 전체가 아니라 **Collection 또는 Object마다** 따로 생긴다. 각 상태는 그 노드의 property 값만 바꾸고, 상태 값의 구조는 Base property와 같다(숫자는 숫자, 같은 블록의 같은 인자).
- 머신이 없는 노드는 **Generate state machine**으로 AI가 상태를 세밀하게 계획한다. 복잡한 interaction은 보통 8~20개 상태, 노드당 최대 32개 상태·128개 전이. 대기·접근·누름·드래그·놓기·정착·완료·취소·복귀처럼 입력이나 동작이 달라지는 경계를 나누고, 같은 동작의 프레임만 늘리지 않는다. 정적인 노드는 머신이 없다.
- 모든 전이는 이유를 말하는 semantic label을 가진다(예: **원 위에 포인터 진입**, **드래그 시작**, **유효한 영역에 놓기**, **성장 완료**). 입력을 기다리는 상태는 실제 입력 이벤트로, 시간이 흐르는 단계만 timed 전이로 넘어간다.
- 여러 노드의 머신은 동시에 독립적으로 동작한다. 코드는 모듈 안에서 `m.state("nodeId")`로 노드별 상태를 읽고 `m.emit("nodeId", "transitionId")`로 이벤트를 보낸다. 두 ID 모두 문자열 리터럴로 직접 호출해야 한다(서버가 호출마다 그 모듈의 노드·전이 ID와 대조하기 때문).
- 하단 **State Machine** 패널은 선택한 노드의 그래프만 보여준다(노드 선택기, 재생·일시정지·재시작, 현재 상태에서 가능한 이벤트 버튼, 그래프 위 전이 라벨과 툴팁).
- 그래프는 패널 안에서 **pan**한다: 빈 곳을 드래그하거나 스크롤하고, 더블클릭하면 원위치로 돌아간다(노드를 바꾸면 초기화).
- 그래프에서 **state 또는 transition을 눌러 선택**한다(주황 테두리). 배경을 누르면 선택이 풀린다(state 선택 시 열린 상태 편집도 Base로 돌아감).
- **state 박스와 transition 라벨은 드래그로 옮긴다.** 화살표는 옮긴 박스 가장자리를 따라 다시 그려지고, 라벨을 옮기면 화살표도 그 라벨을 지나도록 휘어지고(양 끝은 라벨 쪽 박스 가장자리에서 나감), state를 옮겨도 라벨은 원래 자리에서 옮긴 만큼의 거리를 유지한다. 위치는 프레임·노드별로 프로젝트에 저장되며 **Auto layout**으로 자동 배치로 되돌린다. Refine 때 AI에 보내는 그래프 이미지도 옮긴 배치를 쓴다.
- **Refine state / Refine transition / Refine machine**은 바로 실행되지 않고, 어떻게 바꿀지 적는 입력칸을 연다. 입력칸에는 선택한 state/transition이 "첨부됨" 칩으로 표시되고(×로 첨부 해제 → 머신 전체), 보내면 그 항목을 중심으로 필요한 부분만 바꾼다. 나머지 state·transition의 id·라벨·값은 그대로 둔다.
- 패널의 **Annotate**로 그래프 위에 직접 그린다(지우기·취소 표시, 새 화살표, 동그라미 등). Annotation이 있으면 입력칸에 "Annotation n획 첨부됨"으로 뜨고, Refine 때 그래프 이미지(첨부 항목은 주황, annotation은 코랄)와 각 획이 닿은 state/transition 목록이 함께 AI에 전달된다. 텍스트 없이 annotation만으로도 보낼 수 있다.
- Refine 결과는 그 프레임의 **Compose your sketch → AI prompt**에도 반영된다. AI가 현재 prompt의 해당 노드 bullet만 고치거나 하나 추가하고 나머지 bullet은 그대로 둔다(prompt가 비어 있으면 새로 쓴다). 이 프레임이 Compose로 만들어졌고 원본 스케치의 prompt가 같다면 원본 prompt도 함께 바뀐다. 이 요청은 `machine-refine` intent(`prompts/machine-refine.md`)로 처리한다.
- 별도의 constraint 패널은 없다. 그래프에서 상태를 누르면 미리보기가 그 상태로 이동하고 **우측 패널이 그 노드의 property로 바뀌어 해당 상태의 값이 뜬다.** 이때 슬라이더 편집은 그 상태에만 적용되고 Base를 누르면 공통 값을 편집한다. 상태 이름·설명과 나가는 전이(라벨·트리거·지연)도 우측 패널에서 고친다.
- 상태 값과 전이 시간·라벨 수정은 코드의 호스트 블록에 바로 반영되어 다시 생성하지 않아도 미리보기에 적용된다.

## 10. 여러 스케치 프레임과 사진 붙여넣기

- 왼쪽 툴바에서 새 스케치 프레임을 추가한다. Extract·Compose도 원본 옆에 새 스케치 프레임을 만든다. 각 프레임은 독립적인 그림·사진·Undo/Redo·장면·결과를 가진다.
- 스케치 표면·제목·Focus 버튼을 클릭하면 그 프레임이 선택되고, 테두리와 제목이 초록색으로 강조된다.
- 사진 첨부·붙여넣기는 현재 선택된 프레임에 적용되고 그 프레임의 Undo/Redo에 포함된다. 프레임(본문이나 헤더)을 클릭해 선택한 뒤 ⌘/Ctrl+V로 이미지를 붙여넣으면 그 프레임에 들어간다. 프레임을 클릭해도 키보드 포커스가 생기지 않으므로 붙여넣기는 창 전체에서 받는다. 텍스트 입력창에서는 일반 텍스트 붙여넣기를 유지하고, 대화상자가 열려 있거나 AI 생성 중이면 무시한다.
- 프레임 그림·사진·위치는 프로젝트 저장·내보내기·불러오기에 포함한다. 추출로 만든 프레임은 어느 스케치에서 나왔는지 기억하고 헤더에 표시한다.

## 11. 프레임별 패널과 결과

- 프레임마다 장면(노드·블록·머신), 선택, 상태 편집 위치, 생성 코드와 편집 중인 초안, Compose prompt, Generation direction을 따로 보관하고, 프레임을 선택하면 그 프레임의 패널로 전환한다.
- 각 프레임의 결과는 그 프레임 안에 그려지므로 여러 프레임의 결과를 동시에 본다. 슬라이더·코드 수정·Run/Pause·Re-render·annotation은 그 프레임에만 적용된다.
- 장면·결과 코드·프레임 위치는 저장·내보내기·불러오기에 포함하고, 실행 중 상태와 annotation 초안은 작업 중에만 프레임별로 유지한다.
- **AI 작업도 프레임별로 관리한다.** 요청·취소·진행 상태가 프레임마다 따로라서, 한 프레임에서 생성 중에 다른 프레임을 눌러도 그 생성은 끊기지 않고 끝까지 진행되어 그 프레임에 결과가 들어간다. 여러 프레임에서 동시에 생성할 수도 있다. 생성 중인 프레임은 헤더에 "AI 작업 중"이 보이고 ×로 그 프레임의 작업만 취소한다(하단 Cancel은 지금 프레임의 작업). 다른 프레임에 있는 동안 끝난 작업은 화면을 그 프레임으로 끌고 가지 않는다(Extract·Compose로 생긴 새 프레임도 자리만 만들어진다). 프로젝트를 열거나 새로 만들 때만 모든 프레임의 작업을 멈춘다.

## 12. Semantic pen과 Compose

- 블록에서 **Make pen**하면 블록 의미를 담은 색 연필이 툴바에 추가된다(AI 없음). 펜은 자유로운 선만 그리고, 각 획에 그 블록 스냅샷을 저장한다. 펜 색은 어떤 블록을 담았는지 구분하는 표시다.
- 펜 semantic과 색은 툴바에서 수정한다. 이미 그린 획은 그릴 때의 의미를 유지하고, 펜을 지워도 기존 획의 의미는 남는다.
- **Compose sketch**는 스케치 이미지, 순서가 있는 펜·연필·지우개 자국, 획별 블록 스냅샷과 Compose prompt로 **Collection 장면**을 만들고(펜 블록을 같은 id로 재사용), Extract처럼 원본 옆의 **새 스케치 프레임**에 담아 그 안에서 결과를 생성한다.
- Compose prompt가 비어 있으면 AI가 스케치와 획 의미로 초안을 먼저 채운다. **AI prompt 만들기/다시 만들기**로 설명만 생성·갱신할 수 있고, 요청 중 사용자가 고친 prompt는 덮어쓰지 않는다.
- brush 레시피·brush 그리기 도구는 없다.

## 13. Interaction pen

- 사용자 interaction을 스케치에 annotate하는 **Interaction pen**을 기본 제공한다. 클릭·탭 대상, 호버 영역, 드래그 경로와 방향, 놓기 위치, 키 입력 반응을 그린다.
- 펜 설정에서 semantic과 색을 편집하며, 이미 그린 획은 그릴 때의 의미를 보관한다. Erase·Undo·Redo를 지원하고 저장·불러오기·AI 로그 복원에 포함한다.
- AI prompt 작성, 추출·Compose, state planning, 코드 생성에 이 획의 좌표·의미를 함께 보낸다. AI는 annotation을 그림으로 복제하지 않고 입력 대상·동작·반응으로 해석해, 대상 노드의 머신과 실제 p5 입력 callback·위치 검사로 연결한다.

## 14. 결과 annotation과 수정 제안

- 결과가 있는 프레임 헤더의 **Annotate**로 결과 위에 자유롭게 스케치한다(번호·획별 설명 없음). Annotation은 프레임의 일반 획과 별도로 맨 위 층에 그려지며, 지우개·Undo·Redo·전체 지우기를 지원하고 결과는 유지한다.
- 흐름: **자유 스케치 → AI text clarification → 사용자 확인·수정 → Collection·property·블록 변경 제안 → Confirm**.
- Clarification은 AI가 annotation 전후 이미지와 장면을 보고 편집 가능한 초안으로 쓴다. 스케치를 바꾼 뒤 다시 만들 수 있다.
- 제안은 노드·property·블록의 추가·변경·삭제와 재구성을 Before/After로 보여준다. 기존 노드의 원본 스케치 영역은 유지한다. Confirm 전에는 실제 장면과 결과를 바꾸지 않고, Confirm하면 코드를 다시 생성·실행 검증한 뒤 함께 적용한다. 스케치나 clarification이 바뀌면 이전 제안은 다시 요청해야 한다.

## 15. 실제 엔진과 LLM 연결

- 스케치와 결과 실행에는 p5.js 엔진을 쓴다.
- 추출, transformation·property 재생성, state planning, 코드 생성, Compose와 prompt 초안, clarification, 수정 제안에 실제 LLM을 연결한다. 모델은 `OPENAI_MODEL`(기본 `gpt-6.1-sol`).
- 환경 파일은 서버에서만 읽고 API 키를 브라우저에 노출하지 않는다.

## 16. 프롬프트 폴더

- 모든 AI 프롬프트는 프로젝트 루트 **`prompts/`**에 Markdown으로 둔다. 의도마다 한 파일(`extract`, `compose`, `transform`, `state-machine`, `code`, `compose-prompt`, `clarification`, `revision`)이고, 공통 규칙은 `prompts/contracts/`(scene 모델, state planning, scene 코드 계약, interaction annotation)에서 `{{include:…}}`로 포함한다.
- 각 프롬프트 파일 끝에 **출력 JSON 형식과 예시**를 적고, 서버가 실제로 보내는 strict JSON Schema를 `prompts/schemas/<intent>.json`에 둔다. 스키마를 바꾸면 `npm run prompts:schemas`로 다시 쓰고, 파일이 실제 스키마와 다르면 테스트가 실패한다.
- 서버는 요청마다 프롬프트 파일을 다시 읽어 재시작 없이 반영한다. `RULEGEN_PROMPT_DIR`로 위치를 바꿀 수 있고 Docker 이미지에도 포함한다.

## 17. AI 생성 로그와 복원

- 모든 AI 생성 요청을 서버의 `ai-generations/<날짜>/<시각-의도-ID>/`에 저장한다: 입력 이미지, 사용자 입력, AI에 보낸 prompt, 원본 응답, 최종 검증 결과, 코드는 `generated.js`, 모델·시간·상태·소요 시간·token 사용량. 실패·취소도 기록하고, API 키와 인증 헤더는 저장하지 않는다. 폴더는 Git에서 제외하며 `RULEGEN_AI_LOG_DIR`로 위치를 바꾼다. AI를 부르지 않는 로컬 편집(블록 끼우기, Make pen, 슬라이더, 레이어 편집)은 기록하지 않는다.
- 상단 **AI history**에서 기록을 조회하고(종류·시각·모델·상태), 결과와 오류를 확인하고 JSON으로 내려받는다.
- 완료된 생성은 **이 생성 복원하기**로 AI 재호출 없이 복원한다. 새 생성은 `context.json`(생성 직전 프로젝트·대상 스케치·라쏘 영역·annotation·clarification·검토 중 제안)과 `recovery.json`(복원용 프로젝트)을 함께 저장한다. 미확정 제안은 검토 상태로 복원하고 자동 적용하지 않는다. 보드도 그때 모습으로 돌아온다: 프레임 위치(proxy frame 포함)와 화면 시점(camera, 확대 배율)을 그대로 복원하고, 시점이 없는 옛 기록만 대상 프레임으로 화면을 옮긴다. 복원은 현재 로컬 초안을 교체하므로 먼저 Export project로 내보내도록 안내한다.
- OpenAI의 일시적 오류(과부하 503, 500/502/504, 요청 한도 429)는 2초·4초·8초 간격으로(Retry-After가 있으면 그 값) 최대 3번 자동 재시도한다. 사용 한도 소진(`insufficient_quota`)이나 키·모델 오류는 재시도하지 않는다. 재시도한 응답은 `response-<회차>-retry<n>.txt`와 `log.json`의 `retries`에 남는다.
- **오류 로그**: 화면에 뜨는 모든 오류를 `error-logs/<날짜>/<시각-출처-ID>.json`에 하나씩 저장한다(Git 제외, `RULEGEN_ERROR_LOG_DIR`로 위치 변경). 출처는 `ai`(AI 생성 실패: 의도·모델·HTTP 상태·OpenAI 오류 코드·`ai-generations/` 생성 폴더 키), `prepare`(코드 안전 검사 실패와 그 코드), `runtime`(생성 코드를 브라우저에서 실행할 때 난 오류와 그 코드), `ui`(그 밖에 프레임에 표시된 오류), `server`(요청 형식 등)다. API 키는 지우고, 이미지 data URL은 길이만 남긴다. 서버가 이미 기록한 오류는 브라우저에서 다시 기록하지 않는다.
- 실패·취소 기록은 복원하지 않는다. 로그 폴더 밖 파일 접근을 막고 이미지 참조와 복원 형식을 검증한다.

## 18. 프레임 삭제

- 각 프레임 헤더의 휴지통 버튼으로 프레임을 삭제한다. 프레임을 삭제하면 그림·사진·장면·결과·패널·Undo/Redo·선택 상태를 함께 정리하고, 다른 프레임은 유지한다(추출된 프레임은 원본과 독립적이다).
- **여러 프레임 한꺼번에 삭제**: Select 도구로 보드의 빈 곳에서 드래그하면 박스가 그려지고, 박스에 걸친 프레임들이 파란 테두리로 선택된다(Shift+드래그는 추가 선택, 헤더 Shift+클릭은 하나씩 넣고 빼기). 이 상태에서 Backspace/Delete를 누르면 선택한 프레임을 모두 삭제한다. AI 작업 중인 프레임은 남기고 선택된 채로 둔다. 선택된 프레임 헤더를 끌면 함께 움직이고, 빈 곳 클릭·프레임 안 클릭·Esc로 선택이 풀린다. Select 도구에서는 빈 곳 드래그가 박스 선택이므로 보드 이동은 Space+드래그, Hand 도구, 휠/트랙패드로 한다.
- 선택된 프레임을 삭제하면 남은 프레임으로 선택을 옮긴다. 기본 원본 스케치도 삭제할 수 있으며(내용을 비우고 숨김) **Add sketch frame**으로 다시 표시한다.
- 삭제 상태는 로컬 저장과 JSON 내보내기·불러오기에 반영한다. 그 프레임이 AI 생성 중일 때는 그 프레임의 삭제를 막고(다른 프레임은 삭제할 수 있고 그 프레임들의 생성은 계속된다), 오래된 비동기 결과가 삭제된 프레임을 되살리지 않게 한다.

## 19. 이전 형식 호환 없음

- 이전 형식(visual feature·rule widget, 프레임 단위 state machine, brush 레시피, 별도 결과 프레임, 예전 펜 스냅샷)은 지원하지 않는다. 변환 코드는 모두 지웠다.
- 프로젝트 형식은 `version: 2`다. 이전 형식의 로컬 저장본·JSON은 열지 않고 새 작업실을 연다. 예전 의도(analyze·rules·subfeature·brush)의 AI 로그는 복원하지 않는다.
- Semantic pen은 블록(`algorithm: { call, library }`)과 출처(`source: { nodeId, label }`)만 저장한다.

## 20. 생성 코드의 `top` API 오인 오류 수정

- 반복 오류 **`코드에서 지원하지 않는 API: top`**은 생성 코드의 모든 `top` 식별자를 금지 API로 본 검사 방식 때문이었다(예: `const top = 28`).
- 코드 검사는 선언과 사용 범위를 확인한다. 코드 안의 지역 변수·함수 파라미터가 `top`, `parent` 등과 이름이 같아도 허용하고, 선언되지 않은 전역 접근(`window.top`, 전역 `parent`)과 금지된 속성 접근(`p.top`, `p["top"]`), `eval`·`Function`·`constructor`·`__proto__`·`prototype`은 계속 차단한다. 반복·재귀 실행 한도도 유지한다.

## 21. 코드 구조(모듈화)

- `app/lib/scene/`: schema(모델), values(바인딩·슬라이더), algorithms(블록 라이브러리·재사용·가져오기), transfer(블록 복사·붙여넣기·드롭, 레이어 다른 스케치로 복사), graph(레이어 트리 연산), machines(노드별 상태와 런타임 블록), convert(AI 출력 → 장면), validate, revisions, pens, live, panel-ops(패널 단위 순수 편집 함수)
- `app/server/`: `intents.server.ts`(의도별 스키마·전처리·후처리), `prompts.server.ts`(프롬프트 로더), `scene-code.server.ts`(AST 검사와 호스트 블록 연결), `code.server.ts`(실행 안전 검사), `ai.server.ts`(전송·일시 오류 재시도·로그)
- `app/studio/`: 라우트와 분리한 액션 레이어(장면 편집·블록 복사/붙여넣기/드롭, AI 생성, 결과 revision)
- `app/components/scene/`: Layers, Property 패널, 소켓·블록 편집기, 블록 팔레트, 우클릭 메뉴, 장면 오버레이, 노드 상태 그래프 · `frame-render.tsx`: 프레임 안의 결과 층과 annotation 층 · `code-preview.tsx`: sandbox 실행과 값 실시간 반영 · `tool-rail.tsx`: 왼쪽 툴바 · `raw-code-panel.tsx`: 하단 코드 보기·편집
- `app/lib/workspace.ts`: 프레임 배치(새 프레임은 원본 옆 빈 자리)
- `app/lib/brushes.ts`: brush 모델·툴 id·자동 생성·찍을 원본 · `app/studio/brush-actions.ts`: 찍기·stroke·드래그 재생 · `app/lib/inspection.ts`: 단계 기록, constraint 행, 오버레이 수식 계산 · `app/studio/inspection-actions.ts`: targeted inspection 요청, 값 적용, 추천 적용 · `app/components/inspection-panel.tsx`, `inspection-overlay.tsx`: 하단 Inspection 패널과 프레임 오버레이

## 22. Brush: Collection → Brush Stamp

- **어떤 노드가 brush가 되나**: AI가 만든(Extract·Compose) 장면의 최상위 노드는 모두 brush가 된다.
  - Collection이면 안의 노드는 그 brush의 부분이다.
  - 혼자 있는 Object여도 brush가 된다. 예: 하나의 형태를 그려 Compose하면 그 형태는 Object 하나로 나온다.
  - 인터랙티브한 것(state machine이 있는 것)은 배경이라도 모두 brush가 된다.
  - 빠지는 것은 캔버스를 거의 다 덮고 아무 동작도 없는 정지 배경 Object뿐이다(`isBackdrop`).
  - 예전에는 최상위 Collection만 brush가 되어, 식물 하나를 Compose하면 brush가 생기지 않았다.
- **이름**: 화면에서는 Collection을 **Brush Stamp**라고 부른다(레이어 패널, 우측 패널, 새로 만들기·그룹·해제, 안내 문구). 데이터와 AI 프롬프트 안에서는 여전히 `collection`이고 기능은 같다.
- **Master와 instance**: brush의 **master**는 원본 프레임에 있는 그 Collection이고, 다른 곳에 찍힌(또는 Layers에서 끌어 놓은) 복사본은 모두 **instance**다.
  - Layers 패널의 루트 행에 **◆ Master** / **◇ Instance** 배지가 brush 색으로 붙는다. 우측 패널은 선택한 노드(멤버 포함)가 속한 brush와 역할을 맨 위 배너로 보여준다. Instance 배너에는 **Go to master**(master 프레임으로 가서 master를 선택)와 **Detach as new brush**가 있다.
  - 툴바 brush 그룹 패널의 **MASTER** 항목은 master가 있는 프레임을 보여주고, 누르면 그곳으로 간다.
  - **Instance에서 semantic transformation의 구조(설명, property·블록 교체, 추가·삭제·순서, AI regenerate)나 state machine(state·transition 편집, 생성·삭제·refine)을 바꾸려 하면 바로 적용하지 않고 안내 창이 뜬다.** 노드 설명 변경, Targeted inspection의 transformation·state·transition recommendation 적용도 같다.
  - **단순 값 조절은 instance에서도 바로 된다**(안내 없음): semantic transformation의 값 슬라이더·입력, Targeted inspection의 value fix와 값 recommendation. 그 instance만 바뀐다. 선택지는 세 가지다.
    - **Detach and create new brush**: 그 instance를 원래 brush에서 떼어 **새 brush의 master**로 만든 뒤, 방금 하려던 변경을 적용한다. 새 brush는 툴바에 생기고, 원래 brush의 Targeted inspection 도구와 그 프레임에 기록된 단계를 이어받는다. 쓰던 도구도 새 brush의 같은 도구로 바뀐다. 원래 brush와 다른 instance는 그대로다.
    - **Edit the master in <프레임>**: master로 가서 그곳에서 바꾼다.
    - **Cancel**.
  - Master가 있던 프레임이 삭제되었으면 Go to master 대신 **Make master**가 나온다. 그 instance가 brush의 master가 되고, 안내 창에서 고르면 변경도 적용된다.
  - 이름 바꾸기, 보이기/숨기기, 이동, state 보기 선택은 instance에서도 그냥 된다.
  - **Brush stamp 삭제**: 우측 패널 brush 배너의 **Delete stamp**(master면 **Delete master**)로 그 Collection 전체를 프레임에서 지운다. Layers의 휴지통과 Select 도구의 Delete 키도 같다.
    - 통째로 지우면 그 프레임의 결과 코드는 그대로 live다(Update가 필요 없음). 지운 stamp의 instance만 멈추고, 모듈은 프로그램에 남아서 같은 brush를 다시 추가하면 바로 나타난다.
    - Layers 되돌리기로 지운 stamp를 되살리거나 찍은 stamp를 되돌려도 live가 유지된다. Collection이나 object를 통째로 넣거나 빼는 변경은, 그 루트의 모듈이 프로그램에 있으면 코드가 그대로 맞는 것으로 본다. 그 밖의 구조 변경은 여전히 Update가 필요하다.
    - Master를 지우면 brush는 저장된 사본으로 계속 쓸 수 있고, instance에서 Make master로 새 master를 정할 수 있다.
  - Master에서 바꾼 내용은 앞으로 찍는 instance에 쓰인다. 이미 찍힌 instance는 자동으로 따라 바뀌지 않는다.
- **Brush 자동 생성**: AI가 Collection을 만들 때마다(**Extract**, **Compose**) 그 장면의 **루트 Collection 하나당 brush 하나**가 툴바에 Brush tool group으로 생긴다. 중첩된 Collection은 그 brush의 부분이라 따로 만들지 않는다. 최대 32개이며 프로젝트에 저장된다. 원본 Collection에는 brush 표시(`brushId`)가 붙는다. 찍은 복사본도 이 표시를 이어받아 그 brush의 Inspection 도구로 검사할 수 있다. 원본 프레임을 지워도 brush는 저장된 장면·코드 사본으로 계속 찍히고, 그 복사본에도 표시가 붙는다(예전에 표시 없이 찍힌 복사본은 brush의 노드 id로 알아본다).
- **Brush 도구 동작**(brush tool group들을 하나의 Brush 도구로 통합)
  - 툴바의 Brush 버튼을 누르면 마지막으로 쓴 brush(없으면 첫 brush)의 도구(그 brush가 기억하는 도구, 기본은 Brush)가 선택되고 Brush 패널이 열린다. 한 번 더 누르면 닫힌다(Esc, × 로도 닫힘).
  - 패널 **위쪽은 brush 고르기**: brush마다 카드 하나(썸네일, 색, 이름, sub brush·targeted 도구 수)가 나오고, 고른 brush가 강조된다. 카드를 누르면 그 brush의 기억된 도구가 선택되고 패널은 열린 채로 아래 내용이 그 brush 것으로 바뀐다. 목록이 길면 그 안에서 스크롤한다.
  - **썸네일**: 패널을 열 때마다 각 brush의 master 프레임 결과에서 master 영역(약간 여유를 둔 가로로 긴 모양)을 잘라 새로 찍는다. 그 부분이 비어 있으면(입력해야 그려지는 brush 등) 이전 썸네일을 그대로 두고, 한 번도 찍지 못했으면 색 막대만 보인다. 썸네일은 brush와 함께 프로젝트에 저장되어 master 프레임이 지워져도 남는다.
  - **Master 프레임 강조**: 패널이 열려 있는 동안 고른 brush의 master가 있는 프레임이 brush 색 테두리로 강조되고, 프레임 왼쪽 위에 「◆ MASTER · 이름」 배지, master 영역에 점선 박스가 보인다. 목록에서 다른 brush에 마우스를 올리면(또는 키보드 포커스) 그 brush의 master로 잠시 바뀐다. 패널을 닫으면 사라진다.
  - 패널 **아래쪽은 고른 brush의 도구·옵션**: **Brush**, **Inspection**, **Inspection annotation** 도구, 그 brush에 지금까지 만든 **Targeted inspection 도구들**(concern마다 하나, ×로 삭제), **SUB BRUSHES**, brush 설정(master 위치, 이름, 삭제)이 있다. Targeted inspection 도구는 처음에는 없다(23절).
  - 아래에서 도구를 고르면 Brush 버튼 아이콘이 그 도구 아이콘으로 바뀐다. brush를 삭제하면 패널은 남은 brush로 넘어간다.
- **Brush 도구 = 추가 또는 interaction**: Brush 도구로 프레임 위를 클릭하거나 드래그하면
  - **그 프레임에 그 brush가 없을 때**: 제스처를 시작한 자리에 Collection **하나**가 멤버·블록·상태 머신과 함께 **그 프레임의 장면에 생성**되고, **AI를 거치지 않고 바로 그려진다.** brush의 코드 모듈(원본 프레임 프로그램에서 꺼낸 것, 원본이 없으면 brush가 보관한 사본)을 그 프레임 프로그램에 넣고 새 노드를 그 모듈의 instance로 추가하기 때문이다. 이름이 같은데 내용이 다른 모듈이 이미 있으면 `tree~2`처럼 새 이름으로 넣는다. 그리고 **그 제스처(누름·움직임·놓기)가 그대로 결과에 입력으로 전달**되어, brush가 곧바로 반응한다(프로그램이 처음 준비되는 짧은 동안 입력을 모아 두었다가 이어서 보낸다).
  - **이미 있을 때**(master든 instance든): 더 찍지 않고 **interaction**으로 동작한다. 활성 프레임에서는 결과가 입력을 직접 받고, 다른 프레임에서 시작한 제스처는 그 프레임을 활성으로 만들면서 결과에 전달된다. 그 프레임에 결과가 아직 없으면 결과를 먼저 생성하라고 안내한다.
  - 예전의 클릭/드래그 동작 방식 설정(stamp·drag, 획을 따라 여러 개 찍기)은 없어졌다.
  - **처음 추가할 때도 바로 반응한다.**
    - Brush 도구는 프레임에 자기 표시를 그리지 않는다. 제스처 경로 점선과 레이어 박스·선택 박스가 보이지 않는다.
    - 결과가 실행 중인 프레임에서는 프로그램을 다시 불러오지 않는다. 서버가 안전 처리한 brush 모듈만 실행 중인 결과에 그 자리에서 넣고, 새 instance가 곧바로 시작한다. 그래서 그 프레임에서 돌던 것(다른 brush의 상태, `m.store`)도 초기화되지 않는다.
    - Brush 도구를 고르거나 그 도구로 프레임 위에 마우스를 올리면, 그 brush를 추가한 프로그램을 미리 서버에서 안전 처리해 둔다. 그래서 실제로 칠할 때는 서버를 기다리지 않는다. 미리 준비된 프로그램은 값만 다른 프로그램끼리 함께 쓴다.
    - 첫 제스처가 전달되는 동안에는 결과가 숨김 상태가 아니라 실제로 보이며(숨긴 결과는 브라우저가 그리지 않음), 전달된 누름이 결과에 포커스를 준다. 포커스가 없으면 입력을 무시하는 brush(p5 `focused` 확인)도 첫 드래그부터 반응하고, 이어서 키 입력도 결과로 간다. 결과 안에서 누른 Esc도 brush 사용을 끝낸다.
    - 결과가 아직 없는 빈 프레임은 프로그램을 새로 띄우므로 잠깐 기다린다. 첫 프로그램은 바로 띄운다. 기다리는 동안의 입력은 모아 두었다가, 한 번에 보내지 않고 몇 프레임에 나눠 보낸다. 그래서 brush가 따라잡는 동안에도 부드럽게 움직인다.
  - Layers에서 루트 노드를 다른 프레임으로 끌어 놓는 것도 같은 방식으로 AI 없이 복사된다(루트가 아닌 노드는 모듈이 따로 없어서 예전처럼 그 프레임 코드를 AI로 다시 만든다).
- brush가 찍히려면 원본 프레임의 결과 코드가 한 번은 생성되어 있어야 한다(그때 brush가 모듈 사본도 보관한다). 이전 형식(모듈이 아닌) 코드를 가진 프레임에는 찍을 수 없고, 그 프레임을 Update로 다시 생성하라고 안내한다. 그 프레임 코드를 AI로 다시 생성하면 복사본도 자기 id로 쓰인 모듈을 새로 받는다.

## 23. Inspection Tool과 Targeted Inspection Tool

두 도구 모두 **inspection 대상 brush의 tool group 안에** 있고, **활성 프레임 안의 그 brush 노드에만** 작동한다(master, 다른 프레임에 찍은 instance 모두). 도구를 고르면 하단 패널이 열리고, **Inspection은 State Machine과 따로 자기 영역을 가진다.** 하단 패널 왼쪽이 Inspection이고, 오른쪽은 Code / State Machine 탭이다(검사를 시작하면 State Machine으로 열림). 그래서 단계를 넘기면서 상태 머신을 함께 본다. 두 영역 사이 경계를 끌어 너비를 바꾸고(브라우저에 기억), 두 번 누르면 기본값으로 돌아간다.
- **검사할 프레임 고르기**: Inspection 패널 툴바의 프레임 선택 상자에 그 brush가 있는 프레임이 모두 나온다(◆ master 프레임이 먼저, ◇ instance 프레임). 고르면 그 프레임이 활성이 되고 그 brush가 선택되어 그 프레임을 검사한다. 프레임을 직접 눌러 활성으로 만들어도 된다. 활성 프레임에 그 brush가 없으면 안내와 함께 그 brush가 있는 프레임 목록이 버튼으로 나온다.
- 검사 중 **State Machine 탭은 그 프레임의 그 brush 노드**를 보여준다. 선택한 노드가 그 brush의 것이면 그 노드, 아니면 보고 있는 단계의 노드, 아니면 상태 머신이 있는 brush 노드다.
- **관련 state 강조**(Inspection·Targeted inspection 모두): 그래프에서 보고 있는 단계의 state는 분홍 테두리, 그 단계에서 떠나온 state는 옅은 분홍, 일어난 transition은 분홍 굵은 선으로 강조된다. 다른 노드의 단계라면 그 순간 이 노드가 있던 state를 실행 상태에서 찾아 보여준다. Inspection이 다루는 state·transition은 주황 점선으로 표시된다. 누른 state·transition, targeted 오버레이가 연결된 것과 조건(`in(...)`)에 쓰인 state, recommendation의 대상이 여기에 들어간다. 그래프 위 범례에 "이 단계: A → B (전이)"와 "Inspection 관련: …"이 나온다. 단계를 바꾸면 그 state가 보이도록 그래프가 이동한다.

### Inspection Tool
- **Stepping 기록(항상 자동)**: Recording 버튼은 없다. 실행 중인 결과가 그 brush 노드의 **상태를 바꿀 때마다 한 단계**를 자동으로 기록한다. Inspection 도구를 열어 둔 brush는 늘, **Brush 도구로 그 brush가 있는 프레임을 다루는 동안에는 그 프레임의 모든 brush가 각자** 기록한다(기록은 brush별로 프레임에 저장). 단계에는 노드, 이전 → 다음 state, 발생한 transition(이벤트 또는 시간 전이), 그 순간 brush의 모든 constraint 값과 노드 박스 값, 그리고 **실행 상태**(모듈마다의 `m.store`, 모든 상태 머신의 state·경과 시간, random/noise seed)가 들어간다. 실행 상태는 **전이마다 그 순간에** 따로 찍는다. 한 프레임 안에서 전이가 여러 번 일어나도(곧바로 떠나는 state) 각 단계는 자기 state로 복원된다(기록 시작 단계만 그 프레임 끝에 찍음). 이미지는 저장하지 않는다. **최대 20단계**까지 저장하고 넘치면 오래된 것부터 버린다. 기록 시작 단계도 남긴다(직접 기록하는 버튼은 없다).
- **Reset history**: Inspection 패널 툴바의 **Reset history**로 이 프레임에 저장된 그 brush의 기록을 지운다. 누르면 "n개 단계를 지울까요?"가 그 자리에 떠서 한 번 더 확인하고, 지우면 Live로 돌아간다(다른 brush의 기록은 그대로).
- **Timeline**: 단계는 시간 순 타임라인의 점으로 보인다(가까운 단계도 겹치지 않게 간격을 둔다). 점에 마우스를 올리면 그 이벤트(transition 이름, 노드: 이전 → 다음 state, 시작 후 경과 시간)가 뜬다. 점을 누르거나 타임라인을 따라 드래그해 이동하고, ←/→·Home/End 키와 ◀ ▶로 한 단계씩 움직인다. **Live**(또는 Esc, 마지막 단계에서 →)로 실행 중인 결과를 다시 따라간다.
- **상태 복원**: 단계를 고르면 실행 중인 결과 자체가 그 순간의 실행 상태로 돌아가 멈춘다(스냅샷 이미지가 아님). 멈춰 있는 동안에는 **전이가 일어나지도 기록되지도 않는다.** 그래서 brush 코드가 그리면서 곧바로 state를 바꾸려 해도(예: 마우스를 누르고 있지 않으면 바로 suspended) 그 단계에 그대로 머물고, 타임라인에 단계가 새로 생기지 않는다. 그 단계는 복원 → 한 번 그리기 → 다시 복원 순서로 보여준다. 그래서 같은 단계를 몇 번 골라도 화면이 똑같고, Live로 돌아가면 정확히 그 단계에서 이어진다. 그 상태에서 semantic transformation 값을 바꾸면 그 순간의 상태에서 새 값으로 다시 그린다. Live로 돌아가면 그 상태에서 이어서 실행된다. `m.store`에 일반 데이터(숫자·문자열·배열·일반 객체)로 둔 상태만 복원되며, 그래픽 버퍼 같은 객체는 복원하지 않는다.
- **값의 변화 tracking**: 오른쪽 표에 brush의 모든 constraint가 노드 · transformation · property(· 인자) 순으로 나온다. 고른 단계의 값, 이전 단계와의 차이(Δ), 20단계에 걸친 값의 변화(막대)를 보여주고, 바뀐 값은 강조한다.
- 왼쪽에는 그 단계의 state와 transition이 나온다. state, transition, constraint 행을 누르면 **강조된다**: state·transition은 State Machine 그래프에서 첨부·강조되고, constraint는 우측 패널에서 그 property 카드가 강조되고 스크롤된다.

### Inspection Annotation Tool
- 툴바 brush 그룹 안의 별도 도구다. 프레임 위에 보라색으로 inspection용 annotation을 그린다(동그라미, 화살표, 손글씨 메모). 일반 결과 annotation과 따로 저장되며, 하단 패널에 "Inspection annotation n획 첨부됨"으로 보이고 ×로 모두 지운다. 패널의 **Pen / Eraser**나 **왼쪽 툴바의 지우개**(E 키)로 지우개로 바꾸면(이 도구를 쓰는 동안 툴바 지우개는 스케치 획이 아니라 이 보라색 자국을 지우고, 다시 누르면 펜으로 돌아감), 프레임에서 문지른 자국만 한 획씩 지운다(지나간 곳 가까이에 있는 획 전체). concern을 텍스트로 함께 적을 수 있다.
- **Create targeted inspection**을 누를 때마다 그 annotation과 concern으로 **Targeted Inspection Tool이 하나씩 새로 생긴다.** 새 도구는 brush 그룹의 도구 목록과 하단 패널 탭에 concern 이름으로 추가되고 바로 선택된다(brush당 최대 12개, 프로젝트에 저장). 만든 뒤에는 annotation 초안이 비워진다.

- **Concern Autocomplete**: concern 입력칸 아래 **Autocomplete** 버튼을 누르면 AI가 inspection annotation(과 지금까지 쓴 글)을 보고 concern 문장을 최대 3개 제안한다(`concern` intent, `prompts/concern.md`). 버튼을 누를 때만 요청하고, 자동으로는 요청하지 않는다.
  - 아무것도 안 썼으면 가장 그럴듯한 제안이 입력칸의 placeholder로 보이고 **Tab**으로 넣는다. 쓰기 시작했으면 그 글로 시작하는 제안의 나머지가 회색으로 이어 보이고 **Tab**으로 완성한다. 아래 제안을 눌러서 고를 수도 있다.
  - 표시도 글도 없거나 다른 AI 작업 중이면 버튼이 꺼진다. 다시 누르면 이전 요청을 대신하고, 응답이 오기 전에 표시가 바뀌었으면 그 응답은 버리고 다시 누르라고 안내한다.
  - AI는 annotation이 그려진 결과 이미지, 표시 좌표와 색·굵기, brush 노드의 이름·설명·transformation·property·state 이름만 받는다(값이나 코드는 받지 않는다). 제안은 표시한 그림 위치가 아니라 brush의 한 측면(크기·간격·개수·휘는 정도, 겹침·정렬, 동작)으로, 쉬운 한국어 한 문장으로 쓴다.
  - **바꾸고 싶은 것에 초점**(2026-10-24): 사용자는 코드를 디버깅하는 게 아니라 그림을 다듬는 중이다. 그래서 제안은 "왜 …지?" 같은 원인·오류 질문이 아니라 표시가 가리키는 **무엇을 어느 쪽으로 바꾸고 싶은지**로 쓴다(예: "잎 끝을 더 휘게 하고 싶어", "하트 사이 간격을 더 넓히고 싶어"). 방향을 알 수 없으면 "…을 보고 조절하고 싶어"로 쓴다. 표시는 의도로 읽는다(동그라미 = 이것을 조절, 화살표 = 이쪽으로 늘이기·휘기·옮기기, 두 표시 사이 = 거리·관계, 덧그린 모양 = 이렇게, X = 줄이기·없애기, 손글씨 = 그대로). 사용자가 "왜"로 쓰기 시작했으면 첫 제안은 그 글을 이어 완성하고, 나머지 제안은 바꿀 것을 말한다. `inspect`도 이런 concern이면 그 양을 정하는 값을 모든 항목에 보여 주고, 그 방향으로 바꾸는 handle과 값 수정을 준다.
  - 화면 작업(busy)이나 프레임 오류를 만들지 않는 요청이다. AI history에는 "Concern 제안"으로 남고, 복원해도 프로젝트는 바뀌지 않는다.
- **획 개수**: Inspection annotation 하나(와 그것으로 만든 targeted 도구)는 획을 최대 **128개**까지 보관한다(이전 64개). 넘으면 가장 오래된 획부터 빠지고, AI에도 128개까지 보낸다.
- **Annotation 펜 설정**: Inspection annotation 패널의 Pen 아래에서 다음에 그릴 자국의 **색**(6가지 기본색과 색 선택), **굵기**(1–30px, 프레임 900×600 기준이라 확대하면 같이 커짐), **투명도**(10–100%)를 정한다. 미리보기 선이 함께 보인다.
  - 설정은 이 브라우저에 기억된다. 그릴 때 보이는 선과 그려진 자국 모두 이 설정을 따른다. 이미 그린 자국은 그린 때의 스타일을 유지한다.
  - 지우개는 자국 굵기만큼 더 넓게 닿는다.
  - Targeted inspection을 만들 때 각 자국의 스타일이 도구에 저장된다. AI에게 보내는 이미지에도 그 색·굵기·투명도로 그려지고, 자국별 스타일도 함께 보내진다(`annotationMarkStyles`). 그래서 색으로 서로 다른 곳을 구분해 표시할 수 있다.

### Targeted Inspection Tool
- **처음부터 있는 도구가 아니다.** Inspection annotation으로 만들 때마다 concern 하나에 도구 하나가 생기고, 다시 고르면 그 concern의 오버레이가 프레임에 다시 보인다. 도구를 만들면 프레임의 보라색 inspection annotation 흔적은 사라진다(annotation은 도구에 저장되어 Inspect again 때 AI에 다시 보낸다). **Inspect again**은 지금까지 기록된 단계로 같은 concern의 시각화를 다시 만든다. 툴바 패널에서 ×로 지운다.
- Inspection과 같은 stepping에 더해 그 concern에 맞춘 시각화를 보여준다.
- **오버레이는 그려진 것 위에 놓인다.**
  - 문제: 입력 history에서 다시 그리는 brush(예: Sketch 8의 수풀)는 그려진 항목의 위치가 `m.store`에 긴 점 목록(윤곽선)으로만 있었다. AI에 보낼 때 크기 제한으로 이 목록이 잘려서 AI는 수풀이 어디 있는지 몰랐다. 그래서 폭·간격·잎 개수를 캔버스 왼쪽 아래 빈 곳에 고정 위치 눈금으로 그렸고, 어떤 수풀과도 연결되지 않았다.
  - 점 목록(`[{x, y}, …]`)은 이제 경로 끝에 `@x`, `@y`, `@w`, `@h`, `@cx`, `@cy`, `@n`을 붙여 그 상자로 읽는다. 예: `s("bush", "polygons.2.@x")`, `each` 안에서 `item("@cx")`.
  - AI에도 점 목록을 잘라 보내지 않고 각 항목의 상자로 요약해 보낸다. 그래서 항목마다 위치를 안다.
  - 입력 history(`m.history()`)도 가상 루트 `"@input"`으로 AI에 보내고 오버레이에서 읽는다(`each: "@input:"`, `item("points.@x")`).
  - 프롬프트에 규칙을 더했다: 오버레이는 실제로 그려진 것(항목, 두 항목 사이 간격, 경로, 사용자가 표시한 곳)에 붙인다. 빈 곳에 고정 위치로 눈금이나 값을 띄우지 않는다. 길이는 그 대상 위에, 개수는 그 항목 옆에 둔다. 위치를 알 수 없으면 노드 영역이나 입력 경로처럼 계산할 수 있는 것에 붙이고, annotation 좌표에는 붙이지 않는다.
- **Targeted inspection은 concern에 대한 도구다.** 한 장면에 대한 답이 아니다.
  - concern은 brush에 대한 질문(크기·간격·개수 같은 양, 겹침·간격·정렬 같은 관계, 언제 나타나는지·왜 움직이는지 같은 동작)이다. annotation은 그 질문이 무엇에 대한 것인지 보여 주는 예시일 뿐이다.
  - 도구는 툴바에 남아 나중에 다시 쓰인다. 그 뒤에 그린 항목, 다른 단계, 다른 값, master와 모든 instance에 쓰인다. 그래서 overlay는 표시한 하나가 아니라 그 concern에 해당하는 모든 항목에 `each`로 그린다.
  - 표시한 좌표, 지금 그림의 위치, 고정된 항목 번호, 지금 보이는 항목 개수는 수식에 넣지 않는다. 모두 단계의 값·store·입력에서 계산한다.
- **Master와 모든 instance에 작동한다.** 프레임마다 노드 id가 다르므로(복사하면 `tree-2`처럼 바뀜), 도구는 결과를 brush의 공통 id(코드가 쓰는 id, `codeId`)로 저장한다. 어느 프레임에서 만들거나 Inspect again을 해도 공통 id로 바꿔 저장한다. 보여줄 때는 그 프레임의 id로 바꾼다. 오버레이 수식(`p`·`prev`·`delta`의 값 키, `s`·`len`의 루트, `in`·`elapsed`의 노드), `each`의 루트, 연결(link), value fix와 recommendation의 키·노드가 모두 바뀐다. 한 프레임에 그 brush가 여럿 있으면 오버레이는 모두에 그려지고, value fix와 recommendation은 선택한 것(없으면 첫 번째)에 적용된다. Instance에 적용하면 detach 안내가 뜬다(22절).
- 도구를 만들 때(그리고 Inspect again 때) AI(`inspect` intent, `prompts/inspect.md`)가 brush의 노드·transformation·상태 머신, constraint 키, **기록된 history 전체**(단계별 값, 상태 머신 상태, 각 모듈의 `m.store` 실행 상태), 현재 단계 이미지와 annotation을 보고 다음을 만든다.
  - **오버레이 = history를 따라가는 규칙**: AI는 한 순간의 그림이 아니라 규칙을 만든다. 타임라인에서 단계를 옮길 때마다 **그 단계의 값과 실행 상태로 다시 계산해** 그 단계에 맞는 오버레이가 보이고, 나중에 새로 기록된 단계에도 AI를 다시 부르지 않고 그대로 적용된다. 예: "별 크기 알고 싶어" + 별에 동그라미 → 단계마다 별 크기에 맞는 width·height 사각형과 "w=… (+15)" 숫자.
    - 수식은 `p("key")`(그 단계의 값), `prev`/`delta`(이전 단계와 비교), `s("루트", "경로")`·`len`(그 단계의 `m.store`, 예: 공의 위치·입자 수), `in("노드", "상태")`·`elapsed`(상태 머신), `step`/`steps`를 읽는다.
    - `when`: 조건이 맞는 단계에서만 보인다(예: 드래그 상태일 때만, 값이 바뀐 단계에서만).
    - **잔상**: 보고 있는 단계의 오버레이는 진하게, **다른 모든 기록 단계(이전·다음 모두)의 같은 오버레이는 흐리게** 함께 그린다. 가까운 단계일수록 진하고, 이전 단계는 실선, 다음 단계는 점선이다. 같은 자리에 겹치는 잔상은 가장 가까운 단계 하나만 남긴다. 잔상에 마우스를 올리면 "Step n · transition · 이전 → 다음 상태"가 뜨고, **누르면 프로그램 상태가 그 단계로 이동한다**(타임라인에서 고른 것과 같다). 작은 잔상(80px 이하)은 안쪽 어디를 눌러도, 큰 잔상은 테두리 근처(약 12px)를 누르면 된다. 진한 현재 오버레이를 누르면 지금처럼 연결된 constraint·state·transition이 강조된다.
    - `each`: `m.store`의 배열 항목마다 그린다(예: 입자마다 점).
  - **오버레이를 누르면** 연결된 constraint·state·transition이 강조된다(위와 같은 강조).
  - **순서 표시**: 각 단계의 오버레이(현재·잔상 모두)에 **단계 번호 배지**가 붙고(현재 단계는 채운 배지), 같은 오버레이의 단계별 위치를 단계 순서대로 잇는 흐린 점선과 진행 방향 화살표를 그린다. 항목마다 그리는 오버레이는 첫 항목에만 번호를 붙이고 경로는 그리지 않는다. 잔상의 번호 배지를 눌러도 그 단계로 이동한다.
  - 오버레이마다 AI가 쉬운 말로 붙인 **이름**(예: "지금 별의 크기")이 범례에 보여 각 색이 무엇인지 알 수 있다.
  - **라벨은 서로 겹치지 않게 자동 배치된다**: 도형 위·아래·오른쪽·왼쪽 중 빈 곳에 먼저 놓고, 자리가 없으면 더 떨어진 곳에 가는 연결선과 함께 놓으며, 그래도 없으면 생략한다. 항목마다 그리는 오버레이(`each`)는 처음 3개 항목에만 라벨을 붙인다. 라벨 문구는 사용자가 보는 이름(property·state 라벨이나 크기·위치·속도 같은 일상어)과 숫자·단위로 약 20자 이내이며, AI가 내부 id·코드 변수명·스케치 고유 개념을 용어처럼 쓰지 않도록 프롬프트에서 막는다.
  - **요약**: 단계별로 무엇이 보이는지와 concern의 원인.
  - **Value fix**: 값만 조절해서 해결되면 구체적인 값 변경(base 값 또는 특정 state의 값)을 **Apply**로 바로 적용한다(한 번에 Undo 가능).
  - **추천**: constraint 자체를 바꿔야 하면 semantic transformation, state, transition을 어떻게 바꿀지 제안하고 **Apply with AI**로 적용한다(transformation은 그 transformation 재생성, state·transition은 machine refine에 제안 내용을 지시로 전달). 다른 값 조합이나 다른 constraint 변경으로도 해결되면 대안으로 함께 제안한다. 추천마다 **무엇을 바꾸는지** 칩으로 보인다(노드 · transformation 이름, 노드 · state/transition 이름, 값 추천이면 바뀌는 constraint들). 칩을 누르면 그 대상이 **강조**된다: transformation은 우측 패널에서 그 transformation 카드가 강조되고 스크롤되며, constraint는 property 카드, state·transition은 State Machine 그래프에서 강조된다. 다시 누르면 해제된다.
- 오버레이 수식은 숫자, 사칙연산·비교·논리 연산, 몇 가지 함수와 위 읽기 함수만 허용하는 작은 계산기로 계산한다(코드 실행 없음). `m.store`에서 읽는 위치는 모듈이 실제로 쓰는 값이지만, property만으로 위치를 추정한 수식은 실제로 그린 픽셀과 다를 수 있다.
- AI 결과 중 brush 밖을 가리키는 오버레이·값·추천은 서버에서 걸러낸다.

- **새 transformation 추가 recommendation**: concern과 관련된 기존 semantic transformation이 없으면, AI는 관련 없는 기존 transformation을 억지로 고치지 않고 **새 transformation을 추가**하자고 제안할 수 있다.
  - 이 recommendation은 "새 Transformation" 종류로 표시되고, 칩은 "<노드> · + 새 transformation"이다.
  - **Add with AI**를 누르면 detail의 설명대로 새 transformation을 그 노드 stack 맨 아래에 만들고, 이어서 코드를 다시 만든다. Undo apply로 되돌릴 수 있다.
  - 적용한 뒤에는 그 recommendation이 **실제로 추가된 transformation**으로 바뀐다.
    - 종류는 "Transformation · 추가됨", 칩은 추가된 transformation 이름이고, 버튼은 그 transformation을 다듬는 Apply with AI다.
    - targeted 도구에는 추가된 transformation id(`addedId`)가 함께 저장된다. Undo apply로 그 transformation이 없어지면 다시 "새 Transformation"으로 보인다.
  - 이어서 targeted inspection의 **interactive overlay도 갱신**된다.
    - 새 코드가 실행된 결과를 캡처해, 같은 concern과 annotation으로 `inspect`를 다시 요청한다.
    - 이때 적용한 recommendation, 추가된 transformation id, 이전 summary와 overlay를 함께 보낸다(`inspection.update` → `appliedRecommendation`, `previousSummary`, `previousOverlays`).
    - AI는 아직 맞는 overlay는 유지하고, 새 transformation의 property를 보여 주는 overlay를 더한다. summary와 value fix도 새로 쓴다.
    - recommendation 목록은 사용자가 보던 그대로 유지한다.
    - 새 transformation이 생기기 전에 기록된 단계에는 그 값이 없으므로, 그 값을 읽는 overlay는 그 단계에서 그려지지 않는다.
  - 고치는 안과 추가하는 안을 둘 다 대안으로 낼 수도 있다. 노드의 transformation이 이미 최대 개수면 이 recommendation은 빠진다.
- **여러 transformation을 함께 바꾸는 recommendation**
  - Transformation recommendation은 대상 transformation을 여러 개 가질 수 있다. 주 대상은 `targetId`, 같은 노드에서 함께 바꿔야 하는 다른 것들은 `targetIds`에 들어간다(같은 노드에 실제로 있는 것만 남김).
  - 대상마다 칩이 하나씩 생기고, 각 칩은 자기 transformation 카드 하나만 강조한다.
  - **Apply with AI**는 대상들을 차례로 다시 만든다. 각 요청에는 함께 바뀌는 다른 transformation이 무엇인지와, 이번에는 그중 자기 몫만 하라는 지시가 붙는다. 코드는 마지막에 한 번만 다시 만들고, Undo apply로 전체가 한 번에 되돌아간다.
- **Recommendation 프레임 그룹과 AI 없는 fork (2026-10-29)**
  - targeted inspection을 만들면 recommendation마다 **프레임 그룹** 하나가 원래 프레임 오른쪽(겹치지 않는 자리)에 생긴다. 그룹 안에는 **fork 자리 프레임**, 그 fork의 **Execution 프레임**, **핵심 파라미터 프레임** 세 개가 나란히 있다. 그룹 제목은 "Recommendation · 제목"이다.
  - 그룹 안 프레임은 원래 프레임과 선으로 잇지 않는다(recommendation은 원래 프레임이 아니라 fork에 관한 것). 원인 Execution 프레임만 예전처럼 ◇ 선으로 이어진다.
  - **fork 자리 프레임**: 원래 프레임의 brush 자국을 바뀐 코드로 그린 모습과 recommendation 설명, **Accept · 이 버전으로 fork 만들기** 버튼이 있다. Execution·핵심 파라미터 프레임이 만들어지는 동안은 기다리고, 끝나면 Accept할 수 있다.
  - **Accept = AI 없이 fork**: 핵심 파라미터 프레임이 돌리는 바뀐 코드(없으면 Execution 프레임, 그것도 없으면 inspection preview)를 그대로 fork의 코드로 쓴다. 장면에는 recommendation을 반영한다(`app/lib/preview-fork.ts`): transformation 수정이면 그 transformation 설명에 덧붙이고, 새 transformation 추가면 제목·설명으로 transformation을 만든다. 바뀐 코드가 읽는 새 값은 그 transformation의 property가 되어 inspection·handle로 다룰 수 있다. 같은 모듈을 쓰는 다른 stamp에도 똑같이 넣는다. 값 recommendation은 그 값만 바꾼다. fork 프레임은 그 자리에 들어가고(그룹 안), fork의 targeted 도구가 선택된다. fork에서 **Undo apply**를 누르면 원래 brush 상태로 돌아간다.
  - **fork의 brush 흔적**: fork 프레임의 실행 결과는 원래 inspection이 보고 있던 단계(입력 기록·store·상태)에서 시작한다. 그래서 inspection 도구를 꺼도 그때 그린 brush 자국이 그대로 남는다(AI로 만든 fork도 같음). 이 시작 상태는 저장하지 않아서, 프로젝트를 다시 열면 fork 결과는 처음부터 돈다(inspection 단계는 그대로 남음). fork의 inspection은 원래 inspection이 보던 단계에 고정된 채 복사된다. 예전에는 "가장 최근 단계"로 복사되어, fork 결과가 처음 뜰 때 기록되는 빈 단계가 그 자리를 차지해 brush 자국과 overlay가 모두 사라졌다.
  - 그룹 제목 줄의 **◎ fork inspection 도구** 버튼을 누르면 툴바에서 그 fork brush의 targeted inspection 도구가 선택되고 fork 프레임으로 이동한다. Accept로 fork를 만들기 전에는 비활성이다.
  - **fork의 inspection tool**: Accept로 만든 fork의 targeted 도구에는 그 그룹 핵심 파라미터 프레임의 overlay와 손잡이가 앞에 들어간다(AI 없음, 이름 "… · fork"). 원래 inspection처럼 멈춘 단계의 값을 손잡이로 바꾸며 바뀐 동작(예: 합쳐지는 하트)을 본다. 미리보기 코드가 새로 읽던 값은 fork에서 property가 되었으므로 그 손잡이는 property 값을 바꾼다. 원래 도구의 overlay는 그 뒤에 남는다(최대 12개).
  - 코드가 맞지 않아 만들 수 없으면 자리 프레임에 이유가 뜨고, 패널의 **Fork & apply with AI**로 만들 수 있다. 패널의 Fork & apply 버튼도 그 recommendation의 자리 프레임이 준비돼 있으면 AI 없이 만들고, 아니면 예전처럼 AI로 만든다(원래 프레임 옆, 선으로 연결).
  - **프레임 그룹**: 보드에서 점선 상자로 그 프레임들을 감싸고 위에 제목 줄이 있다. 제목 줄을 끌면 그룹 안 프레임이 함께 움직인다. 제목 줄의 휴지통은 그룹과 그 안 프레임을 모두 지운다. 그룹은 레이아웃과 함께 저장되지만, 탐색 프레임과 fork 자리는 저장되지 않으므로 다시 열면 만들어진 fork 프레임만 그룹에 남는다. 프레임이 다 없어진 그룹은 저절로 사라진다. Inspect again이면 그 도구의 탐색 프레임과 fork 자리를 닫고 새 그룹을 만든다.
- **Execution 조절해보기는 나중에 생성 (체크박스)**: inspection 패널의 "Recommendation preview도 생성" 아래에 있다(이 브라우저에 기억, 기본 꺼짐). 켜고 targeted inspection을 만들면 Execution 프레임(원인과 recommendation마다)은 brush 자국과 함께 자리만 생기고 AI 요청은 보내지 않는다. 프레임 아래 바의 **생성**을 누르면 그때 만든다. 핵심 파라미터 프레임은 예전처럼 바로 만든다. fork 자리는 핵심 파라미터 프레임 코드만 있으면 Accept할 수 있다.
- **fork 다시 그리기(2026-10-30)**: fork 프레임의 **Re-render result**(되돌리기 아이콘)를 누르면 처음 넣어 둔 원래 brush 흔적(시작 상태)을 버리고 빈 상태에서 다시 돈다. 예전에는 다시 그릴 때마다 시작 상태가 다시 들어가서, 합쳐진 큰 하트처럼 그 흔적에서 나온 결과가 리셋해도 남았다. 시작 상태는 fork를 만들 때 한 번만 쓰는 임시 흔적이다. inspection 도구로 보는 단계는 그대로 그 단계의 흔적을 보여 준다.
- **실행 상태를 옮기는 손잡이 (`"move"`, 2026-10-30)**
  - 손잡이는 값만이 아니라 멈춘 단계의 **실행 상태**도 바꿀 수 있다. 그 단계는 바뀐 상태에서 다시 그려진다(그 단계·그 프레임에서만, what-if).
    - `@input:<g>:<at>`: 기록된 입력(stroke) `g`번째(-1은 마지막)의 한 점. `<at>`는 점 번호(-1은 끝), 또는 점이 들어간 길이 비율(`0.5`는 가운데)이다. **move**로 끌면 stroke가 그 점을 중심으로 휜다. 가까운 점일수록 많이 따라오고 양 끝은 고정된다. `@input:<g>`는 stroke 전체를 옮긴다.
    - `@store:<root>:<path>`: 모듈이 `m.store`에 간직하고 다시 읽는 점(move) 또는 숫자(drag/slide/rotate와 `value` 식). 음수 번호는 끝에서부터 센다.
  - move 손잡이는 `value`가 필요 없고 `x`, `y`를 비우면 옮길 점 위에 놓인다. `each` overlay에서는 키에 `${…}`를 넣어 항목마다 그 항목이 나온 입력 점을 잡게 할 수 있다. 끌 때 그 stroke가 옅은 점선으로 보인다.
  - 값은 단계의 what-if(`edits`, 탐색 프레임은 `values`)에 `"dx,dy"`로 저장된다. 단계를 그릴 때 기록된 상태(입력 기록·store)에 적용하고, 바뀐 stroke는 rev를 바꿔 모듈의 memo가 다시 계산되게 한다. overlay와 손잡이도 옮긴 상태를 읽는다.
  - 핵심 파라미터 프레임 프롬프트(`prompts/explore.md`): 사용자가 효과를 켜고 끄는 게 아니라 **메커니즘을 손으로 일으켜 보게** 한다. 첫 손잡이는 조건이 계산되는 입력이나 간직된 상태를 옮겨 조건을 넘나들게 하는 것이다(겹침·가까움·교차·쌓임 → 그 항목들이 나온 stroke 점 1–3개에 move). 그다음 효과에 문턱이나 양이 있으면 그 값이다. on/off 토글은 이것들 옆에만 둘 수 있다. targeted inspection(`prompts/inspect.md`)도 같은 손잡이를 쓸 수 있다.
  - fork의 inspection 도구는 핵심 파라미터 프레임의 손잡이를 그대로 받으므로, fork에서도 멈춘 단계의 stroke를 끌어 하트가 겹쳤다 떨어졌다 하며 합쳐지는 것을 볼 수 있다. 패널 타임라인 아래에 "이 단계의 입력 경로를 손잡이로 옮겨 그렸습니다 (n곳) · 원래대로"가 뜬다. 탐색 프레임 아래 값 목록에는 "옮긴 입력 경로 dx, dypx"로 보인다.
  - 이미 만든 inspection·fork에는 이 손잡이가 없다. Inspect again으로 다시 만들어야 생긴다.
- **추천이 더하는 동작은 state machine에도 (2026-10-30)**
  - 추천이 brush가 돌면서 만나는 일에 반응하게 하면(겹침·만남·합쳐짐·한계 도달 등), 미리보기(`preview`, 탐색 프레임 `edits`)가 `machine` 변경을 함께 준다. 노드, 새 전이(trigger `event`, 예: "하트끼리 겹침 → 합치기"), 필요하면 새 상태(`like`: 값을 물려받을 기존 상태)와 돌아오는 `after` 전이다. 코드는 그 일이 생기는 순간 한 번 `m.emit(노드, 전이)`를 부른다. 프롬프트는 같은 상태로 돌아오는 전이를 우선한다(코드의 상태 검사가 그대로 동작).
  - 서버는 새 id, 있는 상태 사이의 전이, 코드가 실제로 emit하는 event 전이, 무언가 들어오는 새 상태만 남긴다(`app/lib/machine-change.ts`).
  - 탐색 프레임 프로그램과 AI 없이 만드는 fork에 그 상태·전이가 들어간다. fork의 State Machine 패널에 보이고, 일이 생길 때마다 inspection 단계로 기록된다. 같은 모듈을 쓰는 stamp들에도 같이 들어간다. fork 자리 메시지에 "상태 머신에 전이 「…」도 추가됩니다"가 붙는다.
  - AI로 만드는 fork(Fork & apply with AI)의 transformation 추가 경로는 아직 machine을 바꾸지 않는다.
- **탐색 프레임 오류 표시**: 탐색 프레임의 코드가 실행 중 오류를 내면(예: 추천 미리보기 코드) 아래 바에 "코드 실행 오류"와 **다시 만들기**가 뜬다(예전에는 조용히 버려져 손잡이만 사라졌다). 실행은 됐지만 AI가 만든 값 손잡이를 이 단계 그림에서 놓을 자리를 못 찾으면(그 단계에 없는 값을 읽으면) 그 개수와 **다시 만들기**가 뜬다. 조건(`when`) 때문에 숨은 손잡이는 세지 않는다.
- **Recommendation visual preview (켜고 끌 수 있음, 2026-10-29)**
  - Inspection 패널의 Create targeted inspection / Inspect again 위에 **Recommendation preview도 생성** 체크박스가 있다. 이 브라우저에 기억된다(기본 꺼짐).
  - 켜면 inspection을 만드는 같은 `inspect` 요청에서 recommendation마다 간단한 미리보기 코드도 함께 받는다(요청 수는 그대로, 응답이 길어짐). 이때만 출력 스키마에 `preview`가 들어가고 `prompts/inspect-preview.md`가 프롬프트에 붙는다. 끄면 예전과 똑같은 요청이다.
  - `preview`는 brush 모듈을 고치는 작은 코드 수정(`edits`, 1–3개, 합쳐 25줄 안팎)과 그 코드가 읽는 새 값(`values`), 한 줄 설명(`caption`)이다. 값이 아닌 recommendation은 반드시 preview를 쓴다. preview는 제목이 말하는 최종 결과를 한눈에 보이게 그리되 실제 알고리즘은 흉내만 낸다(겹친 윤곽 합치기: 윤곽을 굵게 그린 뒤 안쪽을 종이색으로 채워 바깥 윤곽만 남김 / 새 하트 하나로: 겹친 것은 그리지 않고 모듈의 그리기 함수로 큰 하트 하나). recommendation끼리 결과가 다르면 미리보기도 그 차이가 보여야 한다. 값 recommendation은 `null`이다(그 값 자체로 그린다). 서버는 수정이 brush 모듈에 그대로 들어가고 올바른 코드가 될 때만 남기고, 아니면 `null`로 버린다.
  - 패널에서는 그 recommendation 카드 안에 **PREVIEW** 썸네일(240×160)이 보인다. inspection이 보고 있는 단계의 brush 자국을 프로그램 사본(미리보기 수정 적용, 값 recommendation은 그 값)으로 그린 것이다. 아무것도 적용되지 않는다. preview를 끈 채 만든 결과에는 썸네일이 없다.
  - **시간 비교**: inspection이 끝나면 토스트에 "inspection n초 (recommendation preview 켬/끔)"이 뜨고, targeted 도구 아래에 "지난 inspection n초 · recommendation preview 켬/끔"이 남는다(도구와 함께 저장, `timing`). 이 시간은 `inspect` 요청만 잰 것이다(함께 도는 원인 Execution 요청은 빼고).
- **Recommendation은 brush의 fork에 적용된다 (2026-10-29)**
  - Recommendation 버튼은 **Fork & apply with AI / Fork & apply values / Fork & add with AI**다. 누르면 그 brush 자체에는 적용하지 않는다.
  - 대신 지금 프레임을 옆에 복사해 fork 프레임을 만든다(같은 그림·사진, 장면, 코드, 기록된 inspection 단계). 그 안의 이 brush stamp(recommendation이 바꾸는 stamp, 없으면 첫 stamp)가 **새 brush(fork)의 master**가 된다.
  - fork는 **독립된 brush**다(원래 brush의 sub brush가 아님). Brush 패널 위쪽 목록에 따로 카드로 뜨고 이름 앞에 ⑂ 표시가 붙는다. 색·썸네일은 원래 brush와 같고, 이름은 "brush · recommendation 제목"이다. 이 targeted inspection 도구도 복사되어 들어가서, 아래쪽에서 fork 자신의 도구·targeted 도구·sub brush를 그대로 쓴다. 아래쪽 **FORK** 줄에 "⑂ 원래 brush에서 fork · 「제목」 적용"과 **원래 brush 보기** 버튼이 있다. 원래 brush를 지워도 fork는 남는다. 예전에 그룹 안에 저장된 fork도 불러오면 독립 brush가 된다.
  - Recommendation은 그 fork 프레임에 적용된다(값은 바로, transformation·state·transition은 AI로). 화면은 fork 프레임으로 옮겨 가고 fork의 targeted 도구가 선택된다. 새 transformation 추가면 fork 도구의 overlay가 자동으로 업데이트된다.
  - 원래 brush와 프레임은 그대로다. 원래 프레임에서 fork 프레임으로 「⑂ fork · 제목」 점선 화살표가 이어진다. recommendation 항목 아래에 「⑂ fork에 적용됨 · fork 프레임 이름」 링크가 생기고, 누르면 그 fork로 간다.
  - 같은 recommendation을 또 누르면 fork가 하나 더 생긴다. fork 안에서 다시 적용하면 fork의 fork가 생긴다.
  - fork 정보(`fork`: 원래 brush, 원래 프레임, recommendation)는 brush와 함께 저장된다. Undo apply / Redo와 Update overlays는 fork 프레임 안에서 그 적용에 대해 동작한다(아래 설명 그대로).
- **Recommendation 적용 되돌리기**
  - Recommendation을 적용하면(**Apply with AI** 또는 **Apply values**) 적용 전과 후의 프레임을 함께 저장한다. 저장되는 것은 장면, 결과 코드(transformation 적용 뒤 이어서 다시 만든 코드까지), Compose prompt다.
  - RECOMMENDATIONS 제목 옆 **Undo apply / Redo**로 한 번의 적용 전체를 되돌리거나 다시 적용한다. 장면만 되돌리는 레이어 undo와 달리 코드도 함께 돌아간다.
  - 적용한 recommendation에는 "✓ 적용됨"이 표시된다. 프레임마다 최근 20개까지 저장되고, 새로 적용하면 redo 목록은 비워진다.
  - 적용 뒤에 그 프레임을 더 바꿨다면, 되돌리면 그 변경도 함께 사라진다는 확인이 그 자리에 한 번 더 뜬다.
- **Update overlays (적용한 recommendation에 맞게 overlay 고치기, 2026-10-24)**
  - 적용한 recommendation 항목 안(✓ 적용됨 아래)에 **Update overlays** 버튼이 있다. 값·transformation 수정·새 transformation·state·transition 모든 종류에 있다.
  - 누르면 AI(`inspect`)가 같은 concern으로, 적용된 뒤의 장면과 코드에 맞게 그 도구의 overlay를 다시 만든다. 요청에는 적용한 것(종류, 대상, 값 변경, 추가된 transformation)과 이전 summary·overlay를 함께 보낸다(`inspection.update` → `appliedRecommendation`). 깨진 overlay(없어진 key·store 경로, 그리는 방식이 바뀐 geometry)는 고치고, 바뀐 것에 대한 overlay와 handle은 더한다. summary, 값 수정, 숨은 파라미터 제안, 항목 기록도 새로 받는다. Recommendation 목록은 그대로 둔다.
  - 새 transformation 추가(Add with AI)는 예전처럼 적용 직후 이 업데이트가 자동으로 실행된다.
  - 바꾸기 전의 overlay는 그 적용 기록과 함께 도구에 저장된다(`overlayUpdates`, 최근 10개, 프로젝트에 저장). 업데이트가 항목 기록 코드를 적용했다면 그 적용 기록에도 묶인다.
  - **Undo apply**로 그 recommendation(또는 업데이트가 적용한 항목 기록)을 되돌리면 overlay도 업데이트 전으로 돌아간다. **Redo**로 마지막 것을 다시 적용하면 업데이트한 overlay가 돌아온다. 그 사이 Inspect again을 했다면 그 결과는 건드리지 않는다.
  - 업데이트한 뒤에는 "✓ overlay를 이 적용에 맞게 고쳤습니다 · Undo apply로 함께 되돌아갑니다"와 **Update overlays again**이 보인다. 다시 눌러도 Undo하면 처음 업데이트 전으로 돌아간다.
- **탐색 프레임: 원인·recommendation을 손으로 이해하기 (2026-10-25)**
  - 원인 설명(summary) 아래에는 **Execution 조절해보기** 버튼이 있다. 원인의 값은 이미 overlay handle로 조절할 수 있어서 이 버튼만 둔다.
  - 각 recommendation 항목 안에는 **Execution 조절해보기**와 **핵심 파라미터 조절해보기**가 있다.
  - **targeted inspection 도구를 만들면(또는 Inspect again) 탐색 프레임도 같이 만들어진다.** 원인의 Execution 프레임 하나와 recommendation마다 Execution·핵심 파라미터 프레임 두 개다. 한 프롬프트로 다 만들지 않고 요청마다 따로 보내되, 서버가 한 번에 받는 만큼 **둘씩 함께** 보낸다: ① `inspect`와 원인 Execution(`explore`)을 함께 → ② recommendation 1의 Execution·핵심 파라미터를 함께 → ③ recommendation 2의 둘 → … 순서다. 원인 Execution은 inspection과 동시에 만들어지므로 아직 찾은 원인 없이 concern·표시·코드·기록된 단계만 보고 만든다(프롬프트에 그 경우를 적어 둠). inspection이 끝나면 그 프레임의 요청에 찾은 원인이 들어가 "다시 시도" 때는 원인과 함께 묻는다. 차례를 기다리는 프레임에는 "순서를 기다리는 중"이 보이고, 서버가 바빠 거절하면 잠시 기다렸다가 다시 보낸다. recommendation 3개면 요청 8번이 4번에 나눠 가서, 하나씩 보내던 때보다 기다리는 시간이 약 절반이다. 화면은 원래 프레임에 그대로 있다. Inspect again이면 그 도구의 이전 탐색 프레임은 닫고 새로 만든다. 새 도구를 만들다 inspection이 실패하면 먼저 만들던 원인 프레임도 닫는다. 최대 16개라 넘치는 것은 만들지 않고, 버튼으로 열 수 있다. 기록된 단계가 없으면 만들지 않고 알려준다.
  - 버튼은 그대로 남아 이미 만든 프레임으로 이동하거나, 닫았거나 실패한 것을 다시 만든다.
  - 누르면 원래 프레임 옆에 **새 탐색 프레임**(◇)이 생긴다. 원래 프레임은 바뀌지 않는다.
    - 그 프레임에는 inspection이 보고 있던 단계의 brush 자국이 그대로 있다. 그 단계의 runtime(입력 기록 포함)과 프로그램 사본으로 그린다.
    - AI(`explore`, `prompts/explore.md`)가 손잡이를 만든다. 답을 기다리는 동안에도 brush 자국은 보인다.
    - 같은 것을 다시 누르면 열려 있는 프레임으로 이동한다(버튼에 "열림 · 이동"). 프레임은 최대 8개이고 프로젝트에는 저장되지 않는다.
  - **Execution 조절 (step by step)**: brush 코드의 내부 동작을 **한 단계씩** 실행하고 되돌리며 원리를 이해한다. 사용자가 그린 획을 다시 재생하는 것이 아니고, 한 번에 다 끝나는 손잡이도 아니다.
    - **단계**: AI가 이 프레임 코드에만 체크포인트 `m.trace("이 단계가 하는 일과 이유", { op, …그 순간의 내부 상태 })`를 넣는다.
      - 체크포인트 하나가 단계 하나의 시작이다. 다음 체크포인트까지 그리는 것이 그 단계의 결과다.
      - 단위는 항목마다, 연산마다다. 예: 불꽃 하나의 바깥층, 한 쌍의 비교, 한 번의 합침.
      - 체크포인트가 없으면 그리기 호출 하나하나가 단계가 된다.
    - **기록**: 런타임이 체크포인트와 그리기 호출을 실행 순서대로 기록한다(`rulegenRunStart(budget, roots)`).
      - 탐색하는 brush의 것만 센다. 다른 brush는 그대로 그린다.
      - 기록 중에는 `m.memo`를 다시 계산한다.
      - 실행한 단계까지만 그린다.
    - **단계마다 brush 자국 자체가 바뀐다**: 오버레이는 변화를 가리킬 뿐이고, 변화 자체는 그림에서 보인다.
      - 그리면서 진행하는 코드는 그대로 된다.
      - 계산하고 모은 뒤 마지막에 한꺼번에 그리는 코드(예: bush 윤곽 검사 → 안쪽 제거 → 보존 → 마지막에 그리기)는 중간 단계에서 그림이 안 변한다. 그래서 AI가 체크포인트에 세 번째 인자 `show`를 붙인다: `m.trace(label, data, () => { … })`.
      - `show`는 그 단계 직후의 brush 모습을 brush 자신의 그리기 방식으로 그린다. 예: 지금까지 지운 안쪽 선은 빠지고 나머지 윤곽은 그대로인 그림.
      - 런타임은 지금 도달한 단계의 체크포인트에서만 `show`를 바로 그 순간의 변수 값으로 부른다(`rulegenRunStart(budget, roots, show)`). 그 그리기는 실행 기록에도 단계 수에도 들어가지 않는다.
    - **처음 상태**: 아무 단계도 실행하지 않은 상태에서 시작한다. 완성된 brush 자국은 뒤에 흐리게 보인다.
    - **동사 하나 = 단계 하나**: 코드가 항목에 하는 일마다 별도 연산이고 별도 단계다. 옮기기, 검사, 제거(거르기·잘라내기·숨기기·건너뛰기), 유지, 합치기, 나누기, 키우기, 돌리기, 칠하기 등이다.
      - 제거를 다른 단계에 끼워 넣지 않는다. 예: 수풀마다 1 윤곽 옮기기 → 2 다른 수풀 안쪽 부분 제거 → 3 남은 선 그리기.
      - 단계 data에는 제스처에 필요한 기하를 담는다. 옮기기는 목적지, 제거는 지워질 부분과 원래 항목, 합치기는 양 끝이다.
      - 끝에 한꺼번에 그리는 코드면, 단계마다 그 단계가 만든 결과(지운 부분, 남긴 조각)를 data에 담아 overlay로 보여준다.
    - **제스처 = 그 동사**: 그 단계의 기하로 수행한다. 연산마다 다르게 느껴지게 하고, 모두 "오른쪽으로 끌기"가 되면 안 된다.
      - 옮기기: 목적지까지 끌고 가기(slide, 목적지가 pivot)
      - 제거: 원래 항목에서 밖으로 튕겨 내기
      - 합치기: 한쪽을 다른 쪽에 갖다 대기
      - 키우기: 밑동에서 당겨 내기
      - 돌리기: rotate
      - 칠하기: 경로를 따라 긋기
      - 제거될 부분은 미리 빨간 점선으로 보이고, 지운 뒤에는 흐리게 남는다.
      - 이 동사별 제스처와 data 항목은 예시일 뿐 고르는 목록이 아니다. AI는 brush가 그리는 것과 그 연산의 의미에 맞는 metaphor를 직접 만든다. 예: 불꽃을 부채질해 키우기, 수풀 가지를 가로질러 잘라 다듬기, 잉크를 눌러 번지게 하기. 그 제스처에 필요한 점들은 data에 원하는 이름으로 담는다.
    - **스케치로 단계 실행(`sketches`)**: 손잡이를 끄는 대신, 다음 단계가 다루는 자리(점선 영역)에 펜으로 표시를 그리고 **제출**(Enter)하면 그 단계가 실행된다. 인식은 `app/lib/sketch-gestures.ts`가 한다.
      - 표시 종류:
        - `x`: 지우기, 빼기
        - `circle`: 남기기, 고르기, 묶기
        - `arrow`: 목적지로 보내기
        - `cut`: 가르기
        - `line`: 잇기
        - `tap`: 콕 찍기
        - `check`: 통과
        - `scribble`: 덧칠, 지우기
        - `trace`: 경로 따라 그리기
        - `custom`: AI가 점 목록으로 직접 그린 임의의 모양. 예: 물결, 나선, 지그재그, 괄호. 크기와 그리는 방향에 상관없이 맞춰 본다.
      - 연산마다 손잡이와 스케치 중 맞는 쪽을 쓴다. 둘 다 둘 수도 있다.
      - 아래 막대에 인식 결과가 나온다. 예: "두 번째 획을 그어 X를 완성하세요", "X 표시를 알아봤습니다".
      - 버튼은 제출과 지우기(Esc)가 있다. 표시는 단계가 바뀌면 지워진다.
    - **연산 종류(`stages`)**: AI가 연산 종류마다 번호(`op`), 이름, 원리 설명을 준다. 예: 1 "바깥 불꽃 피우기", 2 "밝은 내부 덧칠".
    - **손잡이**: 연산 종류마다 따로 있다(key `@execution`, 값은 실행한 단계 수, 정수로 맞춤).
      - 다음 단계가 그 종류일 때만, 다음 단계가 다루는 대상 위에 나타난다.
      - 그 연산을 흉내 내는 gesture로 끌면 한 단계가 실행되고, 되돌려 끌면 되돌아간다. 예: 위로 당겨 불꽃 피우기, 옆으로 문질러 내부 덧칠.
      - 값 수식은 `start + 끈 거리 / 한 단계 거리` 또는 `nearestStep(hx, hy)`다.
      - **제스처 한 번 = 한 단계**(`gestureRange`): 충분히 끌면 다음 단계 하나가 실행되고, 반대로 끌면 방금 단계 하나가 되돌아간다. 더 끌어도 거기서 멈춘다. 손을 떼고 결과를 본 뒤, 다음 단계 대상 위로 옮겨 간 손잡이를 다시 잡는다. AI가 그 연산을 하나의 연속 동작으로 표시한 경우(`stages[].many`, 예: 줄지어 놓이는 항목을 펜으로 한 번에 훑기)에만 한 번에 여러 단계가 진행된다.
      - 어느 경우든 그 연산이 연달아 있는 단계들 밖으로는 나가지 않는다(`stepBlock`). 예를 들어 획마다 "주황 전부 → 노랑 전부" 순서인 brush에서, 노랑을 문지르다가 다음 획의 주황 단계로 넘어가지 않는다. 그 연산 묶음이 끝나면 다음 연산의 손잡이가 나타난다. 앞 연산으로 되돌리려면 ◀나 ←를 쓴다.
    - **수식에서 읽는 것**: `s("@last", …)`(방금 실행한 단계), `s("@next", …)`(다음 단계), 필드 `step`, `op`, `none`, `done`, `total`, `x`/`y`/`w`/`h`/`cx`/`cy`, `data.…`. 그리고 `each: "@steps:"`(모든 단계, `done`)를 읽는다.
    - **아래 막대**: 프레임 안이 아니라 프레임 아래쪽 바깥에 붙어 있어서 그림을 가리지 않는다. 그 아래에 새 프레임이 놓일 때는 막대 자리를 비워 둔다.
      - 처음 · ◀ 한 단계 되돌리기 · "단계 k / n" · ▶ 한 단계 실행 · 끝 · 한 단계씩 재생. 키보드 ←/→/Home/End도 된다.
      - "방금 실행"과 "다음"의 설명을 보여준다.
      - 연산 종류 버튼(진행 수)을 누르면 그 연산의 첫 단계로 간다. 지금 연산의 원리 설명도 보인다.
    - 체크포인트 수정은 `m.trace` 호출만 끼워 넣는 것이어야 한다(`traceOnly`). 다른 변경이 섞이면 버린다.
      - 해당할 때만 찍는 조건부 체크포인트(`if (조건) m.trace(…)`, `if (조건) { m.trace(…) }`)는 허용한다.
      - 체크포인트가 버려져 단계가 하나도 없는 연산은 목록과 손잡이에서 빼고, summary에 "「…」 단계는 코드에 넣지 못해 빠졌습니다"라고 적는다.
    - 제스처 안전장치:
      - 손이 12px 이상 움직이기 전에는 단계가 바뀌지 않는다(떨림 무시).
      - 한 번 끌어서 한 단계를 실행(또는 되돌리기)하면 손을 뗄 때까지 그대로다. 목표를 지나쳐 더 끌어도 되돌아가지 않는다.
      - 다음 단계에 쓸 수 있는 손잡이가 없으면(그 연산의 손잡이가 읽는 data가 그 단계에 없는 경우 등) 그 단계 위에 기본 손잡이가 나온다. 어느 방향으로든 끌면 실행된다.
      - 체크포인트 data의 긴 목록은 버리지 않고 200개 이하로 고르게 솎는다(숫자는 소수 한 자리). 예전에는 4000자를 넘으면 목록을 통째로 버려서 그 단계 손잡이가 사라졌다.
      - pivot이 손잡이와 거의 같은 자리여서 측정할 수 없는 제스처(예: 닫힌 윤곽의 시작=끝)는 확실히 끌면 한 단계 앞으로만 간다. 엉뚱하게 뒤로 가지 않는다.
      - 프롬프트도 손잡이와 pivot을 24px 이상 떨어뜨리고 나눗셈 분모를 0에 가깝게 두지 말라고 요구한다.
    - 다른 축:
      - `"input"`: 기록된 입력을 그 지점까지만 실행한다.
      - `"steps"`: 기록된 단계 사이를 오간다.
      - 둘 다 손잡이 하나와 연속 진행도를 쓴다.
  - **핵심 파라미터 조절**: recommendation이 말하는 핵심 값 1–3개를 overlay handle로 끈다.
    - 값 recommendation은 추천 값으로 그려진 상태에서 시작한다. 바꾼 값은 아래 막대에 보이고 하나씩 되돌릴 수 있다.
  - **적용 전 미리보기**: 아직 적용하지 않은 transformation·state·transition recommendation은 AI가 그 프레임 안에서만 쓰는 모듈 수정(`edits`)과 새 값(`values`)을 준다. 두 모드 모두 바뀐 알고리즘으로 동작한다.
    - 수정이 모듈에 안 맞거나 코드가 올바르지 않으면 버리고 지금 코드로 보여준다. summary에 그렇게 적는다.
    - 이미 적용한 recommendation은 지금 코드 그대로 쓴다.
  - 원래 프레임을 지우면 그 탐색 프레임도 함께 닫힌다.
  - 함께 고친 것:
    - 단계를 붙잡아 그릴 때 그 순간 그려진 store를 overlay에 넘기는 연결이 id 비교 문제로 한 번도 동작하지 않았다(`code-preview.tsx`). 고쳤다.
    - 그리는 중에 기록된 단계를 다시 불러올 때, 끝나지 않은 gesture는 끝나지 않은 채로 돌아온다.

## 24. Direct manipulation handle과 proxy frame

Semantic transformation의 property마다 그 property에 맞게 **직접 만든 direct manipulation 인터페이스**(handle)를 두고, 그것을 **proxy frame**에서 조작한다. 정해진 metaphor 몇 개를 고르는 방식이 아니라, AI가 property마다 새 widget을 만든다.

- **Proxy frame**
  - 대상 프레임 옆에 생기는 별도 프레임이다. 한 노드의 handle들을 grid로 나란히 보여준다.
  - 여기서 widget을 조작하면 대상 프레임의 그 노드 값이 바뀌고, 결과가 실시간으로 따라 바뀐다. 거꾸로 슬라이더나 state 선택으로 값이 바뀌면 widget도 그 값으로 다시 그려진다. State를 편집 중이면 그 state의 값이 바뀐다.
  - 헤더에는 handle 수와 편집 중인 state가 표시된다.
  - AI 디자인·redesign은 **property 하나 또는 transformation 하나**에만 한다. 노드 전체를 한 번에 만드는 요청은 없다(서버도 대상 없는 `handles` 요청을 거부한다).
    - property 카드의 ◎, PROXY HANDLE 줄의 Redesign / Fix with AI → 그 property 하나.
    - transformation 카드의 Design with AI / Redesign with AI → 그 transformation의 property들.
    - 빈 proxy frame에는 조절할 수 있는 transformation마다 **Design <transformation>** 버튼이 있다.
  - Inspector의 **Open proxy frame**, transformation 카드와 handle의 **Open proxy**로 연다. 노드마다 하나씩 있고, 이미 있으면 그 프레임으로 이동한다.
  - Proxy frame을 지워도 handle은 property에 남는다. 대상 프레임을 지우면 그 proxy frame도 함께 지워진다. 프로젝트에 저장된다(`proxyFrames`).
- **조작이 대상에 반영되는 방식**
  - Proxy frame은 sandbox iframe이 포인터를 직접 받지 않는다. 위에 놓인 입력 레이어가 포인터를 받아 iframe 안으로 보낸다. 보드를 움직인 직후 같은 때 iframe에 입력이 닿지 않아 조작이 무시되던 문제를 이렇게 고쳤다.
  - 입력 레이어는 widget 영역마다 하나씩만 놓인다. 나머지 영역은 프레임을 옮기는 데 쓰인다.
    - 각 칸의 제목 줄(property 이름·hint)과 칸 사이 빈 곳을 드래그하면 헤더처럼 proxy frame이 보드에서 움직인다. 커서는 move로 바뀐다.
    - widget이 아직 없는 proxy frame은 버튼을 뺀 어디를 잡아도 움직인다.
  - 값이 바뀌어도 결과의 module `setup`은 그 setup이 읽은 값(`m.v`/`m.box`)이 바뀔 때만 다시 실행된다. 그래서 trail·particle·드래그 상태가 값 조절로 지워지지 않는다. 처음 시작과 Re-render에서는 모든 setup이 실행된다. 코드 생성 계약(`contracts/scene-code.md`)도 store를 다시 만들어야 하는 값만 setup에서 읽도록 바뀌었다.
  - **기존 결과를 그 자리에서 조절**: host가 받은 입력(누르고 끌고 떼는 제스처, 최근 24개)을 `m.history()`로 module에 준다. 코드 계약의 "DERIVE FROM THE INPUT" 규칙에 따라 module은 입력으로 만든 것(드래그를 따라 놓인 trail, 클릭으로 찍은 stamp, 끌면서 나온 것)을 입력이 들어온 순간의 값으로 저장하지 않는다. 대신 매 frame `m.history()`와 지금 값으로 다시 계산한다. 그래서 간격·크기·개수를 바꾸면 이미 그려진 결과가 처음부터 다시 그려지지 않고 그 자리에서 바뀐다. state machine 상태와 나머지 store도 그대로다. 입력 기록은 inspection step snapshot에도 들어가서, 지난 step으로 돌아가면 그때의 입력도 함께 돌아온다.
  - **이전 방식 코드의 대체 동작**: 입력을 받으면서 `m.history()`를 쓰지 않는 module은 만든 것에 그때의 값을 저장해 둔다. 이런 코드에서만 값이 바뀌면 처음 상태에서 기록된 입력을 새 값으로 빠르게 다시 실행해(최대 약 200프레임) 새로 그린다. Inspection에서 고정된 step을 보는 중에는 다시 실행하지 않고, 다시 실행 중의 전이는 기록하지 않는다.
  - 대상 코드가 그런 방식이면 proxy frame 아래에 안내가 나오고, **Update code to adjust in place**로 그 프레임 코드를 `m.history()` 기반으로 다시 만들 수 있다. 모양·동작·state machine은 유지하도록 지시한다.
  - 이전 버전으로 만든 저장 프로그램도 열 때 현재 host runtime·driver로 바뀌어(`refreshProgram`) 위 동작을 따른다. Module 코드는 그대로다.
- **Proxy ↔ target 연결 표시**
  - Proxy frame 헤더에 **LINKED → <대상 프레임> / <노드>** 칩이 있다. 편집 중인 state도 함께 표시된다. 마우스를 올리면 대상 프레임과 연결선이 강조되고, 누르면 대상 프레임으로 이동한다.
  - 대상 프레임 헤더에도 그 프레임을 조작하는 proxy frame마다 **◎ <노드> proxy** 칩이 있다. 마우스를 올리면 proxy frame이 강조되고, 누르면 그곳으로 이동한다.
  - 보드에는 proxy frame에서 대상 프레임으로 가는 점선 화살표("◎ 조작")가 그려진다.
  - Proxy frame 안을 누르면 대상 프레임이 활성화되고 노드가 선택된다.
- **Property마다 만드는 인터페이스**
  - Widget은 p5 코드다(`rulegenHandle(function (h) { return { draw, pressed, dragged, released } })`).
  - AI(`handles` intent)는 property의 의미, transformation, 값들(경로·범위·단위·옵션), 그 뒤의 algorithm 설명, 현재 결과 이미지를 보고 widget을 쓴다. 그 property가 그림에 하는 일을 단순화한 미니어처(proxy)를 그리고, 그 일부를 잡아 끌게 한다. 예를 들어 가지 각도는 갈라진 가지의 팔을 끌어 벌리고, 꽃잎 개수는 링의 꽃잎을 돌리고, 진폭은 물결 꼭대기를 끌어 올린다.
  - Algorithm property는 여러 인자를 한 제스처로 함께 조절할 수 있다(예: 점의 x는 간격, y는 흔들림). Temporal property는 `h.time`으로 움직임을 보여준다.
  - Widget API: `h.w/h.h`, `h.mouseX/Y`, `h.pressed/hover/time/color`, `h.v(path)`, `h.spec(path)`, `h.ratio(path)`, `h.set(path, value)`, `h.setRatio(path, t)`.
  - `h.set`은 값을 범위로 clamp하고 step에 맞게 반올림한 뒤 대상에 보낸다. Widget이 바꿀 수 있는 것은 AI가 `paths`에 선언한 값뿐이다.
- **만들기와 고치기**
  - Property 카드의 ◎ 버튼은 그 property 하나를 만든다.
  - Transformation 카드의 **Design with AI / Redesign with AI**는 그 transformation의 property들을 만든다. Proxy frame 헤더는 노드 전체를 만든다.
  - 만든 뒤에는 proxy frame이 자동으로 열린다.
  - Property 카드의 PROXY HANDLE에서 hint를 고치고, "어떻게 바꿀지"를 적어 **Redesign**하고, Widget code를 보고, handle을 지운다.
  - 실행 중 오류가 나면 그 widget 칸에만 오류가 표시되고, 다른 widget은 계속 동작한다. 카드에도 ⚠ 오류가 나타나고, **Fix with AI**는 오류 내용을 함께 보내 고친다.
- **안전과 성질**
  - Widget 코드는 결과 코드와 같은 guard를 거친다. 브라우저 전역과 eval·timer를 쓸 수 없고, 루프와 함수 호출 수가 제한된다. 캔버스를 만들거나 `p.setup`/`p.draw`를 바꿀 수 없다.
  - Widget은 sandbox iframe 안에서 실행되고, guard를 거친 코드(`prepared`)가 property에 저장된다. 쓸 수 없는 API를 쓴 widget은 이유와 함께 빠진다.
  - Handle은 UI 정보다. 코드 재생성이 필요 없고, 다른 AI 요청에는 widget 코드가 보내지지 않는다. Instance에서도 detach 없이 만들 수 있다.
  - Property를 AI로 다시 만들거나 revision을 적용해도, widget이 조절하던 값들이 남아 있으면 handle이 유지된다.
  - 앞서 만든 프레임 위 metaphor handle(Pull·Stretch 등)은 이 방식으로 대체했다. 예전 형식의 handle은 프로젝트를 열 때 빠진다.

## 35. 시작할 때 프레임 배치가 일렬로 돌아가던 문제

- 증상: 앱을 다시 열면(저장된 프로젝트를 불러오면) 옮겨 둔 프레임들이 오른쪽으로 일렬(x 1040, 2080 …, y 0)로 다시 놓이고, 그 배치가 다시 저장됐다.
- 원인: 보드(`freeform-workspace.tsx`)의 화면 맞춤(크기 감시 콜백, 처음 렌더의 fit)이 그 렌더의 레이아웃 전체에 camera만 바꿔 넣어 저장했다. 이 콜백이 저장된 프로젝트를 불러온 **뒤에** 실행되면, 아직 프레임 위치가 없던 처음 렌더의 기본 레이아웃으로 workspace를 덮어썼다. 위치가 없는 프레임은 일렬의 다음 칸으로 배치되었다. 타이밍에 따라 일어나서, 저장된 camera가 없으면 처음 새로고침부터, 있으면 몇 번째 새로고침에서 일어났다(headless Chrome으로 재현).
- 수정: 보드가 workspace를 바꾸는 모든 곳(화면 맞춤, 줌, 휠, 이동, 프레임 드래그, 위치 채우기)이 **그때의 최신 레이아웃을 받아 필요한 부분만 바꾸는 갱신**으로 보낸다. 처음 화면 맞춤은 camera가 이미 있으면 아무것도 하지 않는다.
- 검증: headless Chrome에서 흩어 놓은 배치로 8번 새로고침해도 위치·camera가 유지되고(camera가 없으면 모든 프레임에 맞춤), 프레임 헤더 드래그는 줌에 맞게 옮겨지는 것을 확인했다. 이미 일렬로 저장된 배치는 되돌릴 수 없다.

## 34. 입력은 입력 이벤트로만 끝낸다 (코드 계약)

- 문제: 생성된 수풀 brush 코드가 `draw`에서 매 프레임 `p.focused === false`이면 드래그를 취소했다. Brush 도구는 사용자의 포인터를 결과 iframe에 이벤트로 넣어 주므로 iframe에 포커스가 없을 수 있고, 그래서 드래그가 시작 1ms 만에 `cancelled`로 끝났다. 그 뒤에도 수풀은 입력 기록으로 계속 그려졌지만 상태 머신은 hover에 머물러, 손을 뗄 때 `released` 전이와 inspection 단계 기록이 일어나지 않았다.
- 규칙(`contracts/scene-code.md`, `contracts/interaction.md`): 누르기·드래그는 입력 이벤트(`mouseReleased`, `touchEnded`, touch cancel, 설명된 키)로만 끝낸다. `draw`나 매 프레임 검사에서 `p.focused`, `p.mouseIsPressed`, `p.touches`, `document.hasFocus()`로 끝내거나 취소하지 않는다. Host가 누르기마다 떼기 이벤트를 준다.
- 새로 생성·수정되는 코드부터 적용된다. 이미 만든 brush는 코드를 다시 생성해야 바뀐다.

## 33. Inspection의 Live 없앰

- Inspection 패널의 **Live** 버튼과 Live 상태(단계를 고르지 않고 실행 중인 결과를 따라가기)를 없앴다. Live에서는 결과는 실시간으로 그려지는데 overlay·handle은 마지막 기록 단계의 값으로 계산되어 둘이 어긋났다(예: 수풀 8개가 그려졌는데 overlay는 기록된 2개에만).
- 이제 Inspection·Inspection annotation·Targeted inspection 도구를 쓰는 동안 결과는 항상 **보고 있는 단계**에 고정된다. 단계를 고르지 않았으면 **가장 최근 단계**다. 새 단계가 기록되면 그 단계로 따라간다. 타임라인의 → 와 End는 마지막 단계에서 멈추고, Esc로 Live로 가는 동작도 없다.
- Brush 도구 등 다른 도구로 바꾸면 결과는 고정이 풀리고 실제 최신 상태에서 계속 실행된다(30절의 실행 상태 복원).
- 저장된 상태의 `cursor: null`은 "가장 최근 단계"로 읽는다(`heldIndex`). AI에는 그 단계 번호를 보낸다.

## 32. Overlay handle: 오버레이를 잡아 값 조절 (Targeted inspection)

- Targeted inspection의 overlay마다 **handle**(프레임 위의 잡을 곳)이 붙을 수 있다. 끌면 그 overlay가 보여 주는 값(constraint, 또는 제안한 숨은 파라미터)이 바뀌고, 결과가 실시간으로 다시 그려진다. Overlay와 handle도 새 값으로 다시 계산되어 따라온다. 예: 잎이 휘는 정도면 잎 끝을 끌면 실제 잎이 휘고, 크기면 모서리를 끌면 커진다.
- **슬라이더가 아니라 concern에 맞춘 조작**이다. AI(`inspect`)가 overlay마다 정한다.
  - **무엇을 잡나**(`x`, `y`): 그 값이 움직이는 바로 그 부분(잎 끝, item 모서리, 두 번째 item, 팔 끝, 줄의 마지막 item, 경로 위 점). 식이 그 값을 읽으므로 끄는 동안 잡은 곳도 따라 움직인다. `each` overlay면 조건(`when`)이 맞는 앞의 item 몇 개(최대 8개)에 하나씩 생긴다.
  - **어떻게 움직이나**(`gesture`): `drag`(자유롭게 끌기: 휘게, 당기기), `rotate`(`pivot` 둘레로 돌리기: 각도, 벌어짐, 기울기), `slide`(pivot에서 handle로 가는 선을 따라: 길이, 거리, 줄 위의 개수, 경로 위의 시간).
  - **포인터 → 값**(`value`): 잡은 곳이 포인터 아래 오도록 하는 역함수 식이다. overlay 수식과 같은 계산기로 계산하고(코드 실행 없음), 포인터(`hx`, `hy`), 시작 위치(`sx`, `sy`, `dx`, `dy`), 시작 값(`start`), pivot 기준 각도·거리(`angle`, `startAngle`, `dist`, `startDist`)를 읽는다. 끄는 동안에는 시작할 때의 item·값으로 계산한다.
  - `hint`: 하는 일을 쉬운 말로(예: "끝을 끌어 휘게"). 마우스를 올리면 보이고, 끄는 동안 handle 옆에 hint와 지금 값이 보인다.
  - 상태·전이, 기록된 item별 값(그린 속도 등), 색·선택값을 보여 주는 overlay에는 handle이 없다.
- **모양**: drag는 동그라미, rotate는 동그라미 안 호, slide는 마름모. 끄는 동안 rotate는 pivot 둘레의 원, slide는 선, drag는 시작점에서 이어지는 선이 점선으로 보인다. handle을 잡으면 그 overlay가 연결된 것도 강조된다.
- **값 적용: 그 단계에서만(what-if)**:
  - 값의 범위로 clamp하고 step에 맞게 반올림한다(토글은 0.5부터 켜짐).
  - 끈 값은 property가 아니라 **보고 있는 단계에만** 저장된다(단계의 `edits`). 결과는 그 단계에 고정되어 그 값으로 다시 그려지고(고정된 단계를 그릴 때만 값을 덮어쓰고 그린 뒤 되돌림), overlay·handle도 그 값으로 계산된다. **property 값, 다른 단계, 다른 도구로 돌아갔을 때의 실행 결과는 그대로다.** 다른 단계의 잔상은 그 단계 자신의 값으로 그린다.
  - Inspection 패널의 constraint 표에서 그 값은 주황색으로, "이 단계만 (기록 …)" 표시와 함께 보인다. ×로 기록된 값으로 되돌린다. 단계를 지우면(Reset history) 함께 지워진다. AI(Inspect again)에는 그 단계의 값으로 보낸다.
  - **항목 하나만**: `each` overlay의 handle은 그려진 항목 하나(예: 한 획에서 나온 불꽃 7개 중 하나)에 붙는다. 코드가 그 값을 항목별로 읽으면(`m.v("<key>", id)`, 항목 기록의 `id`) 그 단계에서 **그 항목만** 바뀐다(단계의 `itemEdits`). 결과도 그 항목만 다시 그리고, overlay·handle도 그 항목만 새 값으로 계산한다. constraint 표에는 "항목 n개만"으로 보이고 ×로 함께 되돌린다.
    - 런타임: `m.v(key, id)`는 고정된 단계를 그리는 동안 그 항목의 what-if 값을 돌려주고, 그 밖에는 `m.v(key)`와 같다. 항목 값이 있는 동안 `m.memo`는 캐시를 쓰지 않는다(다른 항목의 결과가 섞이지 않도록).
    - 코드 계약(`contracts/scene-code.md`): 입력으로 만든 항목 기록마다 고정 `id`(`${g.id}:${i}` 등)를 두고, 항목 모양을 정하는 값은 그 항목 계산 안에서 `m.v("<key>", id)`로 읽는다.
    - **반드시 그 항목만**(2026-10-24): `each` overlay의 handle은 어떤 경우에도 다른 항목을 바꾸지 않는다. 예전에는 코드가 값을 항목별로 읽지 않거나 항목 기록에 `id`가 없으면 그 단계 항목 전체에 적용했다. 지금 불꽃 brush는 `curl`을 반복문 밖에서 한 번 읽고 기록에 `id`도 없어서, 모든 불꽃이 함께 바뀌었다. 이제는 다음처럼 한다.
      - Inspect(`records`)가 handle에 필요한 코드 수정을 함께 준다. 항목 기록(부분 기록이면 그것이 속한 항목의 id)에 고정 `id`를 넣고, handle이 바꾸는 값을 그 항목 계산 안에서 `m.v("<key>", id)`로 읽게 한다(`perItem`에 key를 적는다). 제안 파라미터라면 그 `edits`가 처음부터 `m.v("<key>", id)`로 읽는다. 이 수정은 값을 읽는 위치만 바꾸고 계산은 바꾸지 않으므로, 항목별 값이 없으면 그림은 그대로다. 결과가 오면 자동 적용된다.
      - 서버는 `perItem`의 key를 수정된 코드가 정말 항목별로 읽는지 검사한다. 그리고 `each` overlay의 handle은 (records와, 제안 파라미터면 그 수정까지 적용한) 코드가 그 key를 항목별로 읽을 때만 남긴다. 아니면 handle을 빼고, 요약에 "손잡이 n개는 코드가 그 값을 항목마다 따로 읽지 않아 뺐습니다"를 붙인다.
      - 프레임에서는 끄는 순간의 코드로 다시 확인한다. 항목에 id가 없거나 코드가 항목별로 읽지 않으면 **아무것도 바꾸지 않고** Inspect again을 안내한다(전체에 적용하던 대체 동작은 없앴다).
      - 부분 기록(불꽃 끝 5개)이 같은 불꽃의 id를 가지면, 끝 하나를 끌 때 그 불꽃의 값이 바뀌고 그 불꽃의 끝 handle들이 함께 움직인다. 다른 불꽃은 그대로다.
    - **아직 없는 값 읽기(`m.opt`)**: 자동 적용되는 `records` 수정이 아직 Accept하지 않은 제안 파라미터를 `m.v("<key>")`로 읽으면, 그 값이 없어서 프로그램이 "Unknown value"로 멈췄다. Fix with AI로 고친 뒤 다시 inspect하면 같은 수정이 또 적용되어 무한 반복됐다(`flame-envelope/valley-height-scale`, `flame-unit/side-fullness`). 이제 서버가 records 수정 안의 제안 파라미터 읽기를 `m.opt(<지금 코드의 값>, "<key>"[, id])`로 바꾼다. 런타임의 `m.opt`는 값이 있으면 `m.v`와 같고, 없으면(Accept 전, Reject 뒤) 그 값을 준다. 코드 계약에는 앱만 쓰는 호출이니 고칠 때 그대로 두라고 적었다.
  - 결과 그림이 안 바뀌던 문제: 고정 단계를 what-if 값으로 그린 직후, 메시지 처리 끝의 공통 코드가 원래 값으로 한 번 더 그려 화면(캡처)을 덮었다. 그래서 overlay만 움직이고 그림은 그대로였다. 고정 단계를 그린 뒤 바로 끝나게 고쳤다(headless Chrome에서 끄는 대로 불꽃이 넓어지는 것과, 항목별로 읽는 코드에서 잡은 불꽃 하나만 바뀌는 것을 확인).
  - 한계: 고정된 단계를 다시 그릴 때 `setup`은 다시 실행하지 않으므로, `setup`에서만 읽는 값은 what-if가 반영되지 않는다.
  - **아직 Accept하지 않은 제안 파라미터**의 handle을 처음 잡으면, 코드가 그 값을 읽도록 자동으로 property로 노출(Accept)한 뒤 그 단계의 what-if로 적용한다. Instance에서는 다른 구조 변경처럼 detach 안내가 먼저 뜬다.
- 서버: handle이 바꾸는 key가 그 brush의 숫자·토글 constraint이거나 남은 제안 파라미터이고, 식이 계산기로 읽히는(허용된 변수·함수만 쓰는) 것만 남긴다. 아니면 handle만 빼고 overlay는 남긴다. 다른 프레임(instance)에서는 key와 식의 노드 id가 그 프레임 id로 바뀐다. 이전 overlay는 handle 없이 읽는다.
- 검증: handle 위치·역함수(slide·rotate·drag), item별 handle과 조건, clamp·step, 서버 필터, id 변환, 단계별 what-if(그 단계만 바뀜, 잔상은 자기 값, 되돌리기, 패널 표시), 고정 단계를 what-if 값으로 그린 뒤 실제 값 복원, 프레임 위 handle 표시를 테스트했다(전체 169개 통과, typecheck 통과). 실제 AI가 concern마다 알맞은 handle을 만드는지와 브라우저에서 끄는 동작은 아직 확인하지 못했다.

## 31. 숨은 값도 overlay로 (Targeted inspection)

- **문제**: overlay는 property 값(`p`)과 실행 상태(`m.store`)만 읽을 수 있었다. 코드에 고정된 값(예: 수풀 잎이 휘는 정도를 정하는 곡선 제어점 비율)은 property가 아니어서, concern이 바로 그 값인데도 AI는 옆의 다른 property(잎 끝 개수)를 overlay로 보여 주었다. 숨은 파라미터 제안(28절)과 overlay는 서로 연결되지 않았고, 서버는 지금 있는 property에 연결되지 않은 overlay를 버렸다.
- **제안한 파라미터를 overlay가 바로 읽는다**:
  - AI는 숨은 상수를 `parameters`로 제안하면서, 같은 응답의 overlay에서 그 key(`<노드>/<새 property id>`)를 `p("…")`로 읽고 `link.kind: "parameter"`로 연결할 수 있다.
  - 단계에 그 key가 없으면(아직 Accept 전, Accept 전에 기록된 단계, Undo apply 뒤) **지금 코드의 값**(제안의 `value`)으로 계산한다. 그때 코드는 실제로 그 상수를 쓰므로 맞는 값이다. Accept 뒤에 기록된 단계는 property 값을 읽어 슬라이더를 따라간다. Reject해도 코드에는 상수가 그대로라서 overlay는 남는다.
  - 서버는 parameter를 먼저 검사하고, 통과한 parameter에 연결된 overlay만 남긴다. 버린 parameter에 연결되거나 그 key를 읽는 overlay도 함께 버린다.
  - 프롬프트: concern이 숨은 상수에 달려 있으면 옆의 property 대신 그 상수를 제안하고 overlay로 보여 준다. 첫 번째 제안은 concern이 묻는 바로 그 양을 정하는 상수다. 숫자만 띄우지 않고 그 상수가 각 item에 하는 일(예: 굽힘 거리)을 코드처럼 계산해 그린다.
- **배율(scale) 제안**: 하나의 양이 여러 상수로 정해지면(곡선의 제어점 비율 여러 개) `form: "scale"`로 제안한다. 코드는 그 상수들에 `m.v(key)`를 곱하고, 값은 1(지금 그림 그대로)이며 1보다 작게도 크게도 갈 수 있어야 한다(서버가 확인). 카드에는 "배율 ×1"로 보인다. 이전 제안은 `constant`로 읽는다.
- **item 안 부분의 값**: 수풀의 잎처럼 item 안 부분마다 다른 값(잎 끝·제어점 위치, 굽힘)은 `records`로 기록하게 한다. `each`는 한 단계 배열만 돌므로, 부분 기록은 item 목록 옆의 평평한 목록(부분마다 자기 위치)으로 만들고, item 목록을 다시 만드는 곳에서 함께 새로 만든다.
- **우측 property 패널의 제안 파라미터**:
  - Targeted inspection 도구를 쓰는 동안, 아직 정하지 않은 제안 파라미터는 우측 패널(Semantic transformations)에서 **그것이 들어갈 transformation 카드 안**, 그 property들 뒤에 **희미한 property 카드**(점선, 빗금, "제안" 표시)로 보인다. 슬라이더는 읽기 전용이고 값은 지금 코드의 값(배율이면 "배율 ×1")이다. 이유(`reason`)도 함께 보인다.
  - 카드에서 바로 **Accept**(그 transformation의 property로 추가, 코드 재생성 없음)나 **Reject**를 할 수 있다. Accept하면 일반 property 카드가 되고, Reject하면 카드가 빠진다(Inspection 패널 HIDDEN PARAMETERS 카드의 **다시 보기**로 되돌림). Instance에서 Accept하면 detach 안내가 뜬다.
  - Inspection 패널 HIDDEN PARAMETERS 카드의 제목을 누르면 그 노드가 선택되고 우측 패널의 그 카드가 **강조**되고 스크롤되어 보인다. 그 parameter의 overlay나 범례를 눌러도 같다. Accept한 뒤에는 같은 강조가 그 property 카드를 가리킨다. Inspection 패널의 Constraint 표에는 넣지 않는다.
- **`when`은 item마다 계산한다**: `each` overlay의 조건이 item을 읽을 수 있다(예: `item("side") == 0`). 예전에는 조건을 item 없이 한 번만 계산해서, item을 읽는 조건이면 overlay가 아예 그려지지 않았다(수풀 잎 끝 굽힘 overlay가 안 보인 원인).
- **모듈을 바꿔 끼우면 단계를 하나 기록한다**: 숨은 파라미터 Accept나 항목 기록(`records`)으로 모듈만 바뀌면, 실행 중인 결과가 새 코드로 그린 뒤 "이 시점의 값" 단계를 남긴다. 그래서 Live에서도 새 코드가 만든 기록(예: 잎별 굽힘 목록)을 overlay가 바로 읽는다. 예전에는 마지막 단계가 수정 전에 기록된 것이라 Live에서는 보이지 않았다.
- 검증: 제안 값 대체(Accept 전·후 단계), 서버 필터(버린 제안의 overlay 제거), 배율 검사, 우측 패널의 희미한 제안 카드(transformation 안 위치, 읽기 전용, 강조, Accept/Reject), item별 `when`을 테스트했다(전체 162개 통과, typecheck 통과). 모듈 교체 뒤 단계 기록은 실제 브라우저에서 확인하지 못했다. 실제 AI가 수풀 굽힘 concern에 배율 제안과 그것을 읽는 overlay를 만드는지는 아직 확인하지 못했다.

## 30. Targeted inspection 단계 이동

- **모든 단계에 캔버스 배지**: 예전 배지는 각 overlay의 첫 item을 잔상(ghost)으로 그린 것에서만 만들었다. 다른 단계와 정확히 같은 자리의 잔상은 빼므로 그 단계의 배지도 사라졌다. 그래서 item이 쌓이기만 하는 brush(수풀처럼 첫 item이 늘 같은 자리)에서는 캔버스에서 그 단계들로 갈 수 없었다. 이제 배지는 잔상과 따로, 기록된 모든 단계에서 계산한다(`stepBadges`). 같은 자리의 단계들은 배지 하나를 함께 쓴다. 배지에는 보고 있는 단계(또는 가장 가까운 단계) 번호와 `+n`이 표시되고, 클릭할 때마다 그중 다음 단계로 간다(끝에서 처음으로). 툴팁에 그 단계들이 나온다. 그 단계에 그릴 item이 없으면(아직 아무것도 그리지 않은 단계) 배지도 없다. 그런 단계는 패널의 ◀ ▶와 타임라인으로 간다.
- **Live로 돌아가면 최신 상태**: 단계를 고르면 결과의 상태(store·입력 기록·머신 상태)가 그 단계로 바뀌는데, 예전에는 Live를 눌러도 그대로 이어서 실행됐다(최근에 그린 것이 사라진 채로). 이제 처음 단계를 고를 때의 실행 상태를 저장해 두었다가 Live에서 되돌린다.
- 검증: 배지 묶음·다음 단계·순환 테스트(전체 157개 통과). Headless Chrome에서 하트 brush로 단계를 기록하고 1단계로 갔다가 Live로 돌아오면, 결과 이미지가 단계 이동 전과 같은 것을 확인했다.

## 29. Overlay의 item별 값 (Targeted inspection)

같은 숫자가 item마다 반복되는 overlay가 생기던 문제를 고쳤다. AI가 각 item의 값을 볼 수 없어서, 모든 item에 같은 property 범위·기준값을 붙였기 때문이다. 수풀의 "잎 끝 12→3개"·"100→1000px/s"가 그 예다. 고친 내용은 특정 brush에 매이지 않는다.

- **AI가 보는 데이터**: 예전에는 `x`, `y`가 있는 객체가 5개 넘으면 무조건 점 목록으로 보고 영역(`@x`…)으로 줄였다. 그래서 그려진 item 기록(크기·속도·개수 등)의 필드가 AI에게 보이지 않았다. 이제 영역으로 줄이는 것은 `x`, `y`, `t`만 가진 **순수 점 목록**(외곽선·경로·입력)뿐이다. 필드가 더 있는 기록 목록은 앞의 몇 개를 그대로 보낸다. 줄인 목록 끝 표시에는 개수와 전체 영역을 함께 적는다(`…(8 items; all in box @x=… @y=… @w=… @h=…)`).
- **같은 라벨은 한 번만**: `each` overlay의 라벨이 item을 읽지 않으면(`item(…)`, `i`가 없으면) 모든 item에서 같은 문장이다. 이런 라벨은 첫 item에만 단다. 도형은 여전히 모든 item에 그린다.
- **inspect 프롬프트**:
  - 라벨은 그 단계에서 그 대상이 가진 값을 쓴다. 규칙의 범위·기준값·대응 관계("12→3개")는 쓰지 않는다.
  - `each` 라벨은 그 item 자신의 필드를 읽는다. 모든 item에 공통인 값은 `each`가 아닌 overlay 하나나 `summary`에 쓴다.
  - concern의 item별 값이 store의 item에 없으면 property 값으로 대신하지 않는다. 그 대신 그렇다고 `summary`에 쓴다.
- **항목 기록 추가(`records`)**: concern이 item마다 다른 값(그린 속도, 잎 끝 개수 등)인데, 코드가 그 값을 item 기록에 넣지 않는 경우가 있다(따로 저장하거나 지역 변수로만 계산). 그러면 AI가 overlay와 함께 `records`를 준다. 내용은 그 모듈의 item 기록에 필드만 추가하는 코드 수정이다(예: `items.push({ x, y, poly })` → `{ x, y, poly, speed, tips }`).
  - 서버는 수정이 모듈에 정확히 한 번 맞고, 결과가 올바른 코드이고, 각 필드를 실제로 추가할 때만 남긴다.
  - inspect 결과가 오면 자동으로 적용된다. 숨은 파라미터 Accept처럼 모듈만 실행 중에 바꿔 끼우므로 그린 것이 유지되고, Undo apply로 되돌릴 수 있다.
  - 결과 패널의 ITEM RECORDS가 적용 여부를 보여준다. 되돌린 뒤에는 **기록 추가**로 다시 적용한다.
  - 예전에 이 상황에서 숫자를 아예 빼던 프롬프트 규칙("기록이 없으면 보류")은 이것으로 바꿨다.
  - **잘린 기록 수정**(2026-10-24): 코드 수정 한 조각(`replace`)의 길이 제한이 800자였다. 불꽃마다 끝을 기록하는 반복문처럼 긴 수정은 구조화 응답에서 800자에서 잘렸고, 올바른 코드가 아니어서 서버가 버렸다. 그런데 그 기록(예: `flameTips`)을 읽는 overlay는 남아서, 읽을 배열이 없으니 overlay가 하나도 그려지지 않았다. 이제 한도는 `find` 1500자, `replace` 4000자다. 기록 수정이 버려지면, 그 수정이 추가하려던 필드가 기록된 store에 아직 없는 경우 그 필드를 읽는 overlay도 함께 뺀다(`each`·`item()`·`s()`·`len()`·handle 식). 요약 끝에는 "오버레이 n개를 표시하지 못했습니다. Inspect again으로 다시 시도해주세요"를 붙인다.
- **보고 있는 단계는 지금 코드로 다시 그린 값을 읽는다**: 단계를 고르면 결과가 그 snapshot에서 다시 그려진다. 그때 iframe이 그린 직후의 store를 restore id와 함께 보낸다. 그 단계의 overlay는 기록된 store 대신 이 값을 읽는다. 그래서 코드가 기록을 추가하기 전에 기록된 단계에서도, 지금 코드로 다시 계산한 item별 값(`m.history()`에서 매 프레임 다시 만드는 item)이 보인다. 다른 단계의 잔상은 기록된 store를 그대로 쓴다.
- **읽을 수 없는 라벨은 숨긴다**: 식의 한 부분이라도 읽을 수 없으면(그 단계에 없는 값·필드) "?"를 넣지 않고 라벨 전체를 보이지 않는다.
- **코드 계약**(`prompts/contracts/scene-code.md`): 그려진 item 기록에는 위치·크기와 함께, item마다 다르게 정해진 값(그린 속도, 자기 개수·크기·각도·색 선택)을 같은 기록의 필드로 둔다. 예: `{ x, y, w, h, speed, tips }`. 다른 구조에 따로 두지 않는다. 이 계약은 새로 생성·수정되는 코드부터 적용된다. 이미 만든 brush는 Inspect again 때 `records`로 기록이 추가된다.
- 검증: 기록 필드 검증·적용(그림 불변, item에 값 기록), 적용 여부, AI 결과 정리, 패널 표시, 다시 그린 store로 단계 라벨 표시, 읽을 수 없는 라벨 숨김을 테스트했다(전체 156개 통과). Headless Chrome에서 AI 응답만 가짜로 넣었다. 하트 brush로 단계 3개를 기록한 뒤 Inspect again → 기록 추가가 자동 적용됐다(코드 변경, 패널 ✓). 수정 전에 기록된 단계로 가면 다시 그린 store의 새 필드로 하트마다 `#1 #2 #3` 라벨이 나오는 것을 확인했다. 실제 AI가 수풀 코드에 맞는 `records`를 만드는지는 확인하지 못했다.

## 28. 숨은 파라미터 제안 (Targeted inspection)

- Targeted inspection은 brush를 그리는 모듈 코드도 함께 읽는다(`inspect` 요청의 `previous` → 문맥 `code`, 모듈별). concern이 코드에 **고정된 값**(알고리즘 안의 비율, 흔들림 양, 기울기, 겹침 기준, 고정 개수, 색 등)에 달려 있고 그것을 조절하는 property가 없으면, 그 값을 새 property로 노출하자고 제안한다(`parameters`, 최대 4개).
  - 제안마다 노드, 속할 기존 semantic transformation, 새 property(id·이름·효과·설명·**지금 코드의 값**과 범위), concern과의 관계(`reason`), 코드 수정(`edits`: 모듈에서 정확히 한 번 나오는 코드 조각 → 그 상수를 `m.v("<노드>/<property>")`로 바꾼 조각)이 들어 있다.
  - 서버가 수정이 그 모듈에 정확히 적용되는지, 새 key를 읽는지, 고친 코드가 올바른 JS인지, id가 겹치지 않는지, 값이 범위 안인지 확인하고 통과한 것만 남긴다(`app/lib/hidden-parameters.ts`).
- 결과 패널의 **HIDDEN PARAMETERS**에 제안 카드가 뜬다: 이름, 노드·transformation, 이유, 지금 코드의 값과 범위, **Accept / Reject**, "코드 변경 보기".
  - **Accept**: property를 그 transformation에 추가하고(같은 모듈이 그리는 이 프레임의 모든 stamp에), 모듈 코드에 수정을 적용한다. **코드를 다시 생성하지 않는다.** 새 프로그램을 먼저 준비(prepare)한 뒤 실행 중인 결과에 그 모듈만 바꿔 넣고(`rulegenRefreshModule`: 그 모듈의 인스턴스가 새 코드로 바뀌고 `m.store`는 유지), 그래서 이미 그린 것이 사라지지 않는다. 지금 값 그대로 노출하므로 그림은 바뀌지 않는다. 장면과 코드는 한 번에 적용 기록(Undo apply)으로 남는다.
  - 추가되면 카드에 바로 **슬라이더**(색·토글·선택이면 그 컨트롤)가 생겨 concern을 보면서 값을 조절할 수 있다. property 패널에도 생긴다.
  - **Reject**: 카드를 접어 둔다(도구에 저장). **다시 보기**로 되돌린다.
  - instance에서 Accept하면 다른 구조 변경처럼 detach 안내가 뜬다.
  - 코드가 그 사이 바뀌어 수정이 맞지 않으면 추가하지 않고 Inspect again을 하라고 안내한다.
- `m.memo`가 계산 중에 읽은 값(`m.v`)을 기억해 그 값이 바뀌면 다시 계산한다. key에 넣지 않은 값(예: 노출된 파라미터를 헬퍼 함수 안에서 읽는 경우)도 바꾸면 바로 반영된다.
- Frame JSON에도 도구마다 `hiddenParameters`(제안 내용과 accepted / rejected / pending 상태)가 들어간다.

## 27. Frame JSON 복사

- 장면이 있는 프레임 헤더에 **JSON** 버튼이 있다. 누르면 그 프레임 하나를 JSON 하나로 정리한 창이 열리고, **Copy JSON**(클립보드)과 **Download**(`<프레임 이름>.frame.json`)를 할 수 있다. 클립보드가 막히면 내용을 선택해 두고 ⌘C / Ctrl+C로 복사하도록 안내한다.
- 형식 `rulegen-frame/1`(`app/lib/frame-export.ts`):
  - `frame`(id, 이름), `canvas`(900×600).
  - `nodes[]`: id, 이름, 종류, 설명, 부모, 보이기 여부, 캔버스 픽셀 영역(`box`), brush 루트면 `brush`(이름, master/instance).
    - `transformations[]`: semantic transformation과 property(이름, 효과, 설명, 값 — 알고리즘은 블록 구조 그대로). property마다 `constraints[]`에 그 안의 모든 값(코드의 `rulegenParams`와 같은 key, 경로, 종류, 값, 범위·단위·선택지). Direct manipulation handle은 hint와 경로만 넣고 widget 코드는 넣지 않는다.
    - `constraints`: 모든 constraint의 기본값(key → 값).
    - `machine`: 시작 state, `states[]`(id, 이름, 설명, 그 state의 **전체** constraint 값 = 기본값에 그 state의 변경을 합친 것, 기본값과 달라지는 key 목록 `changed`), `transitions[]`(전부).
  - `algorithms[]`: 이 프레임이 쓰는 알고리즘 정의만.
  - `brushes[]`: 이 프레임에 있는 brush마다 id, 이름, 이 프레임의 루트 노드(master·instance), `targetedInspections[]`.
    - 도구마다 id, 이름, concern, `annotation`(만들 때 그린 inspection annotation, 캔버스 픽셀 점과 각 획의 색·굵기·투명도), `summary`, `overlays`(수식 그대로), `valueFixes`, `recommendations`.
    - 도구는 brush 공통 id로 저장돼 있지만, 여기서는 **이 프레임의 노드 id**로 바꿔 넣는다(overlay는 이 프레임의 모든 stamp마다, value fix와 recommendation은 첫 stamp 기준). 새 transformation을 추가한 recommendation에는 지금 읽히는 모습(`current`: 추가된 transformation)을 함께 넣는다.
  - `code`: 제목, 설명, 전체 코드(코드 패널과 같음, 지금 값 반영). 아직 코드가 없으면 `null`.
- 스케치 획과 사진은 넣지 않는다(프로젝트 전체는 Export project).

## 26. 렌더링 시간 제한(Rendering budget)

- 생성 코드와 proxy widget의 모든 반복문·함수에는 안전 장치(`__rulegenGuard`)가 들어간다. 예전에는 한 프레임에 10만 번을 넘으면 "Rendering budget exceeded. Reduce loops or recursion." 에러로 멈췄다.
- 입력 history에서 매 프레임 다시 그리는 방식(DERIVE FROM THE INPUT)에서는 정상 코드도 이 횟수를 쉽게 넘었다. 예: 하트 trail은 하트 하나에 약 700번, 하트가 많아지면 한 프레임에 약 39만 번. 그래서 무한 루프가 아닌데도 에러가 자주 났다(오류 로그에 하루 수십 건).
- 이제 **시간으로** 판단한다: 한 프레임(또는 입력 이벤트·메시지 하나)이 **10초** 넘게 끝나지 않을 때만 멈춘다(처음 2초에서 10초로 늘렸다). 무거워도 끝나는 프레임은 그대로 그린다. 매 프레임, 입력 이벤트마다 시계를 다시 시작한다(`app/lib/render-guard.ts`).
- **프레임 비용이 입력 전체와 함께 커지지 않게 했다.**
  - 문제: Sketch 8 수풀 brush는 캐시 키를 입력 기록 전체(`JSON.stringify(history)`)로 만들었다. 드래그 중에는 점이 늘 때마다 키가 바뀌어 매 프레임 모든 드래그의 수풀과 겹친 선 지우기(선분마다 근처 수풀 안인지 검사)를 처음부터 다시 했다. 수풀이 쌓이면 한 프레임이 2초를 넘었다.
  - `m.history()`의 드래그마다 **`id`**(바뀌지 않고 다시 쓰이지 않음)와 **`rev`**(점이 추가되거나, 손을 떼거나, 점이 솎아질 때마다 바뀜)가 붙는다. 같은 `id`·`rev`면 점도 같다. inspection 단계 복원 뒤에도 그대로이고, 새 드래그는 새 id를 받는다.
  - **`m.memo(key, () => 값)`**: 모듈의 host 캐시. key(짧은 문자열이나 작은 배열)마다 한 번만 계산한다. `m.store` 밖에 있어 inspection 단계마다 복사되지 않는다. 한동안 쓰이지 않은 항목은 지우고(240프레임), 모듈당 4000개까지 둔다. 2000자보다 긴 key(점이나 기록 전체로 만든 key)는 오류로 막는다.
  - 코드 계약: 드래그 하나가 만드는 것은 `m.memo`로 그 드래그의 `id`·`rev`와 쓰는 값으로 한 번만 계산한다. 끝난 드래그는 다시 계산하지 않고, 드래그 중에는 그 드래그만 다시 계산한다. 값이 바뀌면 드래그마다 한 번씩 다시 계산한다. 여러 드래그에 걸친 계산(겹침, 가려진 선, 충돌)은 앞 드래그들의 결과를 바탕으로 드래그마다 나눠 계산하고, 격자나 경계 상자로 근처만 비교한다. 기록 전체를 key로 쓰거나 `JSON.stringify`하지 않는다. `m.store`에는 상태와 그린 항목의 가벼운 목록(위치·크기)만 두고 윤곽 점이나 캐시는 두지 않는다. 도형은 path 하나로 그리고 그리기 호출은 프레임당 수천 개 이내.
  - 이 에러가 나면 메시지에 "드래그마다 m.memo로 한 번만 계산하라"는 안내가 들어가 **Fix with AI**가 그 방향으로 고친다. "Update code to adjust in place" 지시에도 같은 내용을 넣었다.
  - 이미 생성된 코드는 그대로이므로, 그 프레임에서 Fix with AI나 Update로 다시 생성해야 빨라진다.

## 25. Brush 패널 스크롤

Brush 패널 위쪽 brush 목록은 최대 150px(창 높이의 22%까지)이고, 아래쪽 고른 brush의 도구·옵션 영역은 높이가 고정된다(최대 190px, 창이 작으면 그에 맞춰 줄어듦, 최소 80px). Targeted inspection 도구, sub brush, master, 이름 같은 내용이 많아지면 각자 그 안에서 스크롤해 내린다.

## 주요 사용 흐름

1. 무한 캔버스에서 스케치 프레임을 고르고 그리거나 사진을 첨부·붙여넣는다. 필요하면 새 스케치 프레임을 추가한다.
2. 전체 또는 라쏘 영역을 **Extract**하면 원본 옆에 새 스케치 프레임이 생기고, 그 안에 Collection·Object 레이어와 생성 결과가 나타난다. 반복 요소는 count·배치 블록을 가진 하나의 노드로 나온다.
3. Layers 패널이나 프레임 위(Select, V)에서 노드를 선택하고 그룹·해제·중첩·이동으로 구조를 다듬는다. 노드를 움직이면 결과가 그대로 따라 움직인다.
4. 레이어를 다른 프레임으로 끌어 놓으면 그 프레임 안에서 바로 결과가 생긴다.
5. 우측 패널에서 property 소켓의 값을 조절하고, 팔레트의 블록을 끌어 끼우거나 우클릭으로 복사·붙여넣어 구현을 바꾼다. 필요한 property나 transformation만 AI로 다시 만든다.
6. 프레임 헤더의 Run/Pause·Re-render로 동적인 결과를 제어하고, 코드는 하단 패널에서 보고 고친다.
7. 노드마다 state machine을 만들고, 하단 그래프에서 상태를 눌러 그 상태의 property를 우측 패널에서 편집한다.
8. 블록을 Make pen으로 펜으로 만들어 Pencil·Interaction pen과 함께 스케치하고, **Compose**로 새 프레임에 장면과 결과를 만든다.
9. 결과 위에 annotation을 그리고 AI clarification → 변경 제안 → Confirm으로 적용한다.
10. 필요 없는 프레임은 휴지통 버튼으로 삭제하고, AI history에서 생성 기록을 확인·복원한다.
11. Extract·Compose로 생긴 Brush tool group의 Brush로 다른 프레임에 brush stamp를 찍거나 stroke를 그린다. 드래그 brush는 드래그가 그 brush의 인터랙션을 움직인다.
12. 같은 그룹의 Inspection으로 상태 변화를 단계별로 넘기며 constraint 값을 확인하고, Inspection annotation과 Targeted inspection으로 특정 concern의 오버레이·값 수정·추천을 받는다.
13. 노드의 property마다 AI가 만든 direct manipulation 인터페이스(◎, Design with AI)를 proxy frame에 두고, 거기서 직접 조작해 대상 프레임의 결과를 바꾼다.

## 검증

- Direct manipulation handle: widget 저장과 예전 handle 제거, guard(쓸 수 없는 API·캔버스 생성 거부), AI 요청 문맥(의미·값·algorithm·widget 크기)과 결과 정리(중복·다른 노드 제거, 경로 확인, 실행 불가 widget 제외), 다른 요청에서 widget 코드 제외, 재생성·revision 뒤 유지, proxy runtime(가짜 p5에서 드래그 → 값 보고, 범위 clamp, 오류 widget 격리, 외부 값 반영), proxy frame 저장과 대상과 함께 삭제, setup이 읽은 값이 바뀔 때만 setup이 다시 실행되는 것, 저장 프로그램의 runtime 갱신, 보드 연결선 렌더링, `m.history()` 기록·snapshot 복원과 그것으로 만든 결과가 값 변경만으로 다시 배치되는 것, 저장형 module 감지(다시 실행 대체 동작과 코드 업데이트 안내)를 테스트했다. Headless Chrome에서 손으로 쓴 widget을 넣은 proxy frame을 띄워, 드래그로 대상의 Outline width가 2.5 → 6, 탭으로 Filled가 켜지는 것을 확인했다(AI 생성은 mock으로만 테스트). 실제 AI가 만든 Distribution widget으로 heart trail을 그린 뒤 간격을 62 → 107로 끌면, 대상 프레임의 trail이 새 간격으로 다시 그려지는 것을 5번 반복해 확인했다. `m.history()`로 바꾼 heart-trail module에서는 같은 조작으로 기존 하트들이 다시 그려지지 않고 그 자리에서 새 간격으로 배치되었고, 안내도 나오지 않았다.

- 블록 복사·붙여넣기(다른 스케치 포함, 같은 id 다른 정의는 이름 변경, 중첩 한도), 블록 드롭으로 새 property 만들기, 레이어를 다른 프레임으로 복사(멤버·블록·머신·id 충돌)한 뒤 그 프레임 안의 결과 생성, 같은 프레임 내 이동(재생성 없음), Extract가 새 프레임을 만들고 원본 스케치를 문맥으로 결과를 생성하는 흐름, 값만 바뀔 때 프로그램이 같게 유지되어 실행 중 결과에 그대로 반영되는 것, 드래그 데이터 검증을 테스트했다.
- 중첩 5단계(넘친 노드 끌어올리기, 6단계 거부)를 테스트했다. 테스트는 네트워크에 접근하지 못하게 막았다.
- Semantic transformation 스택: 추가·순서 변경·이름 변경·삭제(그 property와 상태 값 정리)·Undo, 지정한 transformation에 블록 넣기, 노드 전체에서 property id 고유와 라이브 키 유지, 노드당 6개 한도, AI의 새 transformation 추가와 같은 id로 교체, 모델이 준 중복 id 정리, 패널의 스택 렌더링을 테스트했다.
- AI 출력 변환·검증, 중첩 블록 바인딩, Group/Ungroup/중첩/이동, 상태별 property 편집, 노드별 state machine 실행(이벤트·timed 전이·일시정지), 코드 계약 위반 거부, prompts 폴더·스키마 동기화, AI 로그 저장·복원, 소켓·블록·팔레트·Layers·State Machine UI 렌더링을 테스트했다.
- 구조·쪼개기·반복 규칙은 **프롬프트로만** 지시하고 서버에서 검사하지 않는다. 예전 서버 검사 코드와 테스트는 `backup/server-checks/`에 보관한다(복원 방법은 그 폴더의 README).
- Brush: 루트 Collection마다 brush 생성, 툴 id, drag brush 판정, 찍은 복사본의 brush 표시와 검사 대상, 클릭 한 번·stroke 간격 찍기·드래그 재생 계획, 툴바 그룹 렌더링을 테스트했다. Inspection: 20단계 제한, 단계 간 변화, brush 값만 거르기, constraint 행, 오버레이 수식(허용되지 않는 식 거부), 단계별 오버레이 배치, Inspection 패널·오버레이 렌더링, `inspect` 요청 문맥과 brush 밖 결과 걸러내기를 테스트했다.
- 모듈 코드 계약(루트마다 모듈 하나, `m` 사용 규칙, p 속성 쓰기·캔버스 호출·전역 변수 금지, 다른 모듈 노드 접근 금지), 모듈 분리 저장과 인스턴스 실행(다른 id의 복사본이 같은 모듈로 그리고 자기 머신으로 입력을 받음), AI 없이 찍기(빈 프레임, 같은 모듈 재사용, 같은 이름 다른 모듈 이름 변경, 이전 형식 거부, brush 사용 시 AI 요청 0회), concern별 targeted 도구 id와 툴바 목록을 테스트했다. 조립한 프로그램을 실제 p5.js(headless Chrome)에서 실행해 두 인스턴스가 각자 박스에 그려지고 합성 마우스 입력이 각 인스턴스의 상태 머신에 전달되는 것을 확인했다.
- 새 transformation 추가 recommendation: 저장된 `addedId`(이전 도구도 그대로 읽힘, 프레임 간 id 변환 후 유지), 적용 후 "Transformation · 추가됨"과 추가된 transformation 칩, Undo로 없어지면 다시 "새 Transformation", overlay 갱신 요청 문맥(`appliedRecommendation`, `previousSummary`, `previousOverlays`)을 테스트했다. headless Chrome에서 AI 응답(transform·code·inspect)을 가짜로 바꿔, Add with AI → 새 transformation 추가 → 코드 실행 → overlay 재요청 → recommendation이 추가된 transformation으로 바뀌고 새 overlay가 그려지는 흐름을 확인했다.
- 실행 상태 손잡이(키 해석, stroke 휘기·끝 고정·rev, store 숫자·점, grip 위치·`${…}` 키, 드래그 오프셋, 검증, shared id 변환, 탐색 프레임 표시)와 machine 변경(정리 규칙, scene·프로그램 반영, emit으로 새 상태 진입, AI 없는 fork) 테스트를 더했다. 전체 215개 통과. 실제 AI로는 아직 돌려 보지 않았다.
- Recommendation preview revise(요청 문맥: 조작·바꾼 값·concern·잡고 있는 단계만, preview 검증, 손잡이 키 거르기, 실패 시 거부), preview marks·handles의 shared id 변환, preview 물체 찾기와 이동·크기·회전 계산, freeform 크롭(외곽선 솎기·너무 작은 크롭 거부·외곽선 안에서만 잡힘)과 이동·크기·회전, fork 자리 메뉴(마저 생성·기본 크롭 도구·Annotation·Revise) 테스트를 더했다. Execution 프레임에서 recommendation 만들기(요청 문맥: 실행 순간·프레임의 recommendation·기존 목록, preview 검증, 아무것도 표시하지 않으면 거부), Execution 프레임의 도구·순간에 묶인 표시·만드는 중 표시 테스트, canvas에 직접 그리는 brush가 단계별로 잘리는지, 단계 없는 프레임을 inspect할 때 지금 모습을 단계로 쓰는지, 누른 곳의 단계 찾기, execution이 속한 곳(없는 것 빼기·화면 표시), 탐색 프레임·fork 자리·그룹 저장과 불러오기 테스트도 더했다. 전체 231개 통과. 실제 AI와 브라우저로는 아직 돌려 보지 않았다.
- 최소 예제 다시 분해(`split` 요청 문맥·id 정리·나눌 수 없을 때, 부모 유지와 자식 프레임·sub brush), transformation 펜(값·algorithm 포함, Compose 문맥), 숨긴 예제 저장 테스트를 더했다. 전체 219개 통과.
- 타입 검사, 전체 테스트 107개, 프로덕션 빌드가 통과했다. 실제 AI가 새 모듈 계약대로 코드를 쓰는지, 그리고 앱에서 드래그 brush를 끝까지 써 보는 것은 확인하지 못했다.
