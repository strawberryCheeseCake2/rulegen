# Rulegen 요구사항 V2 (최신본)

최종 갱신: 2026-10-15 (Collection별 코드 모듈, 즉시 brush, concern별 targeted inspection)

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
- 펜 아래에는 **Brush tool group**이 brush마다 하나씩 놓인다(22절). 그룹 버튼은 그 그룹에서 마지막으로 고른 도구의 아이콘을 보여준다.

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
- transformation 카드의 **Create Minimal Example**은 그 transformation 하나만 시험해 보는 새 sketch frame을 옆에 만든다. 특수한 프레임이 아니라 일반 sketch frame이고, 안에는 collection 하나와 object 하나만 들어간다. collection의 transformation이면 그 collection에 그 transformation만 남기고 구성원 하나를 transformation 없는 평범한 object로 넣는다(구성원이 없으면 빈 object를 만든다). object의 transformation이면 그 object에 그 transformation만 남겨 평범한 collection 안에 넣는다. 상태 머신은 빼고, 쓰는 알고리즘만 가져오며, 프레임 가운데에 배치한 뒤 바로 결과를 생성한다. 첫 코드 생성만 "이 transformation만 보이게 단순하게 그려라"는 지시와 그 프레임 자체 스케치로 하고, 이후에는 다른 프레임과 똑같이 편집·Update한다.
  - 만든 예제는 **sub brush**로도 추가된다. 그 transformation이 속한 brush(그 brush가 sub brush라면 그 부모)의 tool group 안에 들어가고, 툴바에 그룹 버튼이 따로 생기지 않는다. 그 노드가 brush에 속하지 않으면 독립된 brush가 된다.
    - 그룹 패널의 **SUB BRUSHES**에 sub brush마다 Brush 도구와 Inspection 도구가 있다. 이름 기본값은 "<transformation> · example"이고, 색은 부모와 같으며, ×로 지운다.
    - Brush 도구로 다른 프레임에 칠하면 추가되거나 interaction으로 동작하고, Inspection으로 검사할 수 있다. 일반 brush와 같다.
    - 예제 프레임의 collection이 그 sub brush의 master다. sub brush 도구를 쓰는 동안 그룹 버튼 제목은 "부모 › sub brush · 도구"이다.
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
- **Brush tool group 동작**
  - 그룹 버튼을 처음 누르면 그 그룹의 도구(기본은 Brush)가 선택된다.
  - 이미 선택된 그룹을 다시 누르면 도구 패널이 열리고, 한 번 더 누르면 닫힌다(Esc로도 닫힘).
  - 패널에는 **Brush**, **Inspection**, **Inspection annotation** 도구와, 그 brush에 지금까지 만든 **Targeted inspection 도구들**(concern마다 하나, ×로 삭제), brush 설정(master 위치, 이름, 삭제)이 있다. Targeted inspection 도구는 처음에는 없다(23절).
  - 패널에서 다른 도구를 고르면 그룹 버튼 아이콘이 그 도구 아이콘으로 바뀐다.
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
  - AI는 annotation이 그려진 결과 이미지, 표시 좌표와 색·굵기, brush 노드의 이름·설명·transformation·property·state 이름만 받는다(값이나 코드는 받지 않는다). 제안은 표시한 그림 위치가 아니라 brush에 대한 질문(크기·간격·개수, 겹침·정렬, 동작)으로, 쉬운 한국어 한 문장으로 쓴다.
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
- **Recommendation 적용 되돌리기**
  - Recommendation을 적용하면(**Apply with AI** 또는 **Apply values**) 적용 전과 후의 프레임을 함께 저장한다. 저장되는 것은 장면, 결과 코드(transformation 적용 뒤 이어서 다시 만든 코드까지), Compose prompt다.
  - RECOMMENDATIONS 제목 옆 **Undo apply / Redo**로 한 번의 적용 전체를 되돌리거나 다시 적용한다. 장면만 되돌리는 레이어 undo와 달리 코드도 함께 돌아간다.
  - 적용한 recommendation에는 "✓ 적용됨"이 표시된다. 프레임마다 최근 20개까지 저장되고, 새로 적용하면 redo 목록은 비워진다.
  - 적용 뒤에 그 프레임을 더 바꿨다면, 되돌리면 그 변경도 함께 사라진다는 확인이 그 자리에 한 번 더 뜬다.

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

## 25. Brush tool group 패널 스크롤

Brush tool group을 눌러 여는 패널은 제목 줄 아래 높이가 고정된다(최대 380px, 창이 작으면 그에 맞춰 줄어듦). Targeted inspection 도구, sub brush, master, 이름 같은 내용이 많아지면 그 안에서 스크롤해 내린다.

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
- 타입 검사, 전체 테스트 107개, 프로덕션 빌드가 통과했다. 실제 AI가 새 모듈 계약대로 코드를 쓰는지, 그리고 앱에서 드래그 brush를 끝까지 써 보는 것은 확인하지 못했다.
