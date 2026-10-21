# Rulegen 요구사항 V2 (최신본)

최종 갱신: 2026-10-21 (feat/exploration 브랜치: 스케치 → Decompose → 최소 예제·transformation 펜 → Compose)

`init.md` 원문과 이후 대화에서 요청한 내용을 현재 동작 기준으로 하나로 정리한 문서입니다. 지금의 동작과 맞지 않는 예전 내용은 지우고 최신 요구사항으로 덮어썼습니다. 이 브랜치에서는 workflow를 갈아엎어 Extract, Brush(stamp·tool group·master/instance), Inspection·Targeted inspection, Direct manipulation handle·proxy frame, 결과 annotation·수정 제안, state machine 생성·refine, Make pen(알고리즘 펜), 레이어 드래그 복사, Frame JSON을 모두 없앴습니다(필요하면 다른 브랜치로 돌아가면 됩니다). 이전 형식 호환은 지원하지 않습니다(19절).

# Overview

Hand-drawn sketch를 creative coding으로 옮기는 과정을 탐색하며 할 수 있도록 돕는 툴이다. Workflow는 네 단계다.

1. **스케치**: 연필로 그리거나 사진을 붙인다.
2. **Decompose**: AI가 스케치를 **서로 최대한 독립적인 semantic transformation**들로 나눈다(5절).
3. **최소 예제 → transformation 펜**: 나눈 transformation마다 그것 하나만 보여주는 **최소 예제 프레임**이 바로 생기고 코드가 만들어진다. 각 예제는 그대로 **transformation 펜**이 된다(5절, 12절).
4. **Compose**: 펜과 연필로 새 스케치를 그리고 Compose하면, 펜으로 그린 곳에 그 transformation이 적용된 장면과 결과가 새 프레임에 만들어진다. 코드는 그 예제들의 코드를 참고한다(12절).

---

## 1. 작업 공간과 프레임 모델


- 작업 공간은 freeform 무한 캔버스다. 캔버스를 이동·확대·축소하고 프레임을 자유롭게 배치한다.
- 프레임은 역할이 세 가지다: **sketch**(그리고 Decompose·Compose하는 곳), **minimal example**(Decompose가 만든, transformation 하나만 보여주는 프레임), **composition**(Compose 결과). 모두 같은 프레임 모델이라 그 위에 그릴 수 있다. 예제와 composition은 어느 스케치에서 나왔는지 기억하고, 보드에 그 스케치에서 오는 점선 화살표(`example`, `composed`)로 보인다. 원본 스케치가 바뀌면 다시 Decompose/Compose하라는 안내를 띄운다.
- **결과 전용 프레임은 없다.** 결과 전용 프레임은 없다. 모든 프레임은 스케치할 수 있고, 자기 장면(Collection·Object)과 그 장면의 **generated result를 같은 프레임 안에** 그린다. 층은 아래부터 생성 결과 → 스케치 획과 레이어 박스다.
- 직접 스케치하는 입력과 사진 첨부(파일 업로드, 드롭, 클립보드 이미지 붙여넣기)를 지원한다. 스케치 프레임 배경은 흰색이다.
- 기본 스케치 도구: 연필(색·굵기·투명도), 지우개, 라쏘, 이동(pan), 확대·축소, Undo/Redo.
- 프레임 헤더에서 프레임마다 결과를 제어한다: **Run / Pause**(애니메이션·상태 머신 재생과 정지), **Re-render**(처음부터 다시 그리기), **Interact**(결과에 마우스·키보드 입력 주기), **Generate / Update**(코드가 없거나 구조가 바뀐 경우), sketch와 예제 프레임에는 **Decompose**(예제는 더 작게 나누기, 5.1절), 예제 프레임에는 그 예제의 **Pen**(눌러서 그 펜으로 그리기).
- **Interact**를 누르면 그 프레임의 실행 중인 결과만 마우스·터치·키보드 입력을 받는다(프레임 부제에 "interacting"). 그 동안 스케치 획·레이어 박스·이미지 붙여넣기·단축키는 꺼진다. 다시 누르거나(Stop) Esc, 다른 도구를 고르면 끝난다.
- compose 프롬프트 초안 AI는 같은 형태를 다른 모양으로 다시 그린 것(눌림·hover·드래그 중 모습, 화살표로 이은 전/후)을 별도 collection이 아니라 인터랙션 상태에 따라 모양이 바뀌는 하나의 노드로 해석하도록 지시받는다(compose도 같은 규칙).

## 2. 왼쪽 툴바


- 작업 도구와 캔버스 조작 도구는 왼쪽 툴바에 모은다: 스케치 프레임 추가, 사진 첨부, **Select(V)**, 연필(P), 지우개(E), 라쏘(L), 이동(H), Interaction pen·transformation 펜, Undo/Redo/지우기, 확대·축소.
- 연필의 색상·굵기·투명도 메뉴는 연필을 눌렀을 때만 연필 버튼 옆 팝오버로 나타난다.
- Select 도구로 스케치 위의 Collection·Object를 선택하고 움직인다(6절).
- transformation 펜은 자동으로 생기지 않는다. transformation 예제에서 **Make pen**을 누르면 그 예제의 펜이 툴바에 생긴다(12절). 펜을 고르면 설정 팝오버에 그 transformation(이름·대상·property 값)과 **최소 예제 프레임 보기**가 나온다.

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
- 펜에서 가져온 transformation 카드에는 **From pen · <이름> example** 표시가 붙고, 누르면 그 최소 예제 프레임으로 간다(12절).
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
- 다른 프레임의 블록을 의존 블록과 함께 가져올 수 있다. 같은 id에 다른 정의면 이름을 바꿔 충돌을 피하고, 같은 정의면 재사용한다.
- 블록 구조 변경(끼우기·빼기·교체)은 Base에서만 하고, 상태를 편집 중일 때는 값만 바꾼다(9절).

## 5. Decompose와 최소 예제

- sketch 프레임의 **Decompose**(프레임 헤더, 우측 패널 1단계, Layers의 빈 상태)는 스케치(보이는 그대로: 결과 + 획)와 연필·펜 자국, Generation direction을 AI(`decompose` intent, `prompts/decompose.md`)에 보낸다. AI는 스케치를 **object 목록**(스케치 요소가 무엇인지, 최대 6개), **semantic transformation 목록**(최대 10개), 공유 알고리즘 블록으로 돌려준다.
  - transformation 하나는 semantic 동작 하나다(3.1절 규칙과 같음).
  - **최대한 독립적**이어야 한다: 다른 transformation 없이 평범한 대상에 혼자 적용해도 의미가 있고 보여야 한다. 같은 측면(개수, 색 등)을 두 transformation이 겹쳐 다루지 않고, 배치·개수·사본별 변화·한 요소의 모양·스타일·움직임처럼 측면별로 나눈다. 따로 보여줄 수 없는 것만 하나로 둔다.
  - **transformation은 연산만이다.** 스케치 요소가 무엇인지(꽃잎, 잎, 가지 획, 집, 별의 모양)는 object이지 transformation이 아니므로 transformation으로 뽑지 않고 `objects`에 넣는다. "Petal shape", "Pointed tip outline"처럼 요소를 그리는 transformation은 만들지 않고, 요소에 가해지는 것(배치·반복·개수·사본별 변화·성장·재귀·휘기·가늘어짐·말림·흔들림·색·선·질감·움직임)만 돌려준다. object(요소)와 그것에 가해지는 transformation(연산)을 이렇게 구분한다.
  - **스케치의 object**(`objects`): 스케치를 이루는 요소의 종류마다 하나(꽃잎 일곱 장도 하나), 변형되지 않은 **한 개의 모습**으로 준다: `id`, 영어 `name`("Petal"), `primitive`, 한국어 `description`(윤곽·비율·선·기본 색), 또렷한 한 개의 영역(`region`). 개수·배치·사본 간 차이·휘기·움직임처럼 transformation이 하는 것은 넣지 않고, 요소의 모습 중 transformation으로 뽑은 것(예: 사본별 색 변화, 말림)은 뺀 평범한 모습으로 적는다.
  - 각 transformation은 그것을 보여주는 **가장 작은 collection/object 구조**(`nodes`)와 transformation이 붙는 노드(`carrier`)를 함께 준다. **스케치에서 Decompose한 1차 예제는 원본과 비슷하게 보이도록** object를 스케치의 object로 그린다(`object`: 그 object의 id. 예: 꽃잎 방사 반복 → 꽃잎 object를 담은 collection, 꽃잎 끝 말림 → 꽃잎 object 하나). 맞는 요소가 없을 때만 평범한 **대역 도형**(`object: null`, `shape`: `circle` 또는 `square`, 회전·모서리 효과는 정사각형)을 쓴다. 그래도 transformation 자체에는 object의 의미가 들어가지 않는다: 요소는 노드(object)이고, transformation의 이름·설명·property·알고리즘은 연산만 말하며 어떤 도형에도 그대로 작동해야 한다("petal width" 같은 것은 object 몫). collection은 object나 다른 collection을 묶는다(`parentId`). object 여러 개, collection 여러 개, collection 안의 collection(최대 4단계) 모두 가능하며 노드는 최대 8개다. 예: 도형 하나의 연산은 object 하나, 사본 배치·반복은 collection + object 하나, 두 도형 사이의 관계는 collection 안의 object 여러 개, 고리마다 색이 바뀌는 것처럼 단계를 넘나드는 연산은 중첩 collection. carrier가 collection이면 그 구성원 전체에, object면 그 도형 하나에 작용한다. 스케치에서 근거가 있는 영역(`region`)도 준다.
  - **낮은 coupling 규칙**(프롬프트): transformation의 label·설명, property와 알고리즘의 이름·설명은 그 연산만 말한다. 1차 예제가 스케치 요소를 그려도 마찬가지로, 스케치 대상이 아니라 연산 이름("Petal curl"이 아니라 "Tip curl"), "사본"·"도형"·"선" 기준 서술("꽃잎" 금지), 다른 transformation의 색·모양·개수·움직임이나 "~위에/~와 함께" 같은 참조 금지. 여러 사본을 배치·반복·변화시키면 `target: "collection"`, 도형 하나의 모양·스타일·움직임이면 `target: "object"`다. 스케치에서 그 근거가 있는 영역(`region`)도 준다.
  - 모델이 같은 id를 주면 `-2` 등으로 고유하게 바꾼다.
- 결과가 오면 **object마다, 그리고 transformation마다 최소 예제 프레임**을 원본 스케치 오른쪽에 격자(세 줄씩)로 만든다. object 예제가 먼저 온다. 프레임 이름은 "<object> · object", "<transformation> · example"이다.
  - **object 예제**(`example.kind: "object"`)는 스케치 요소 하나를 transformation 없이 한 개만 그린다. 노드 하나(이름·설명·primitive는 그 object), 펜은 없고 더 나눌 수도 없다(Decompose 버튼 없음). 프레임 부제는 "object example", 보드 화살표는 `object`, 우측 패널 머리는 **OBJECT**(이름, 설명, 원본 스케치 링크), 예제 목록에는 `object` 표시가 붙는다. 코드 지시문: "원본 스케치(이미지)의 이 요소처럼(윤곽·비율·선·자기 색) 한 개만, 사본·배치·사본 간 변화·다른 요소·장식·움직임 없이, 재사용할 수 있는 함수로."
  - **같은 도형을 반복하는 그룹에는 항상 개수(count) 조절이 있다.** 모델은 collection마다 `count`를 준다(한 구성원의 사본 그룹이면 사본 수, 서로 다른 구성원이면 `null`). 구성원이 하나뿐인 collection은 모델이 `null`을 줘도 사본 그룹으로 본다(기본 6개). 그래서 도형 하나에 가하는 연산은 collection 없이 object 하나로 둔다.
    - 사본을 **만드는** transformation(반복·배치)은 자기 개수 property나 개수 알고리즘 인자(`count`, `copies`, `instances`, "개수" 등)를 가지고, 그 개수가 펜에도 들어간다.
    - 그 밖의 사본 그룹, 곧 carrier가 아닌 그룹(예: 고리들 ⊃ 고리 ⊃ 점에서 안쪽 고리)과 이미 있는 사본에 **작용만 하는** transformation(줄을 휘기, 크기 감소 등)의 carrier 그룹에는 예제 구조용 `Copies` transformation(id `example-copies`, `count` 하나)을 붙인다. carrier에서는 그 transformation 앞에 오고, 코드는 평범한 사본(일정 간격의 한 줄)을 만든 뒤 transformation이 그것에 작용한다. 펜에는 들어가지 않는다. (예전에는 carrier transformation에 `Count`를 넣었는데, 그러면 작용만 하는 조각도 개수를 갖게 되어 사본을 만드는 조각과 같은 측면을 겹쳐 다뤘다.)
    - 예제 코드 지시문은 이 개수를 읽고 슬라이더로 사본 수가 바뀌게 하라고 한다. 더 작게 나눌 때 보내는 `split` 구조에도 그룹별 개수가 들어간다.
  - 앱이 구조를 정리한다: 중복 id 제거, 부모는 collection만(자기 자신·순환·깊이 초과면 루트로), 빈 collection에는 원 하나를 넣고, carrier가 없으면 첫 object, 없는 object id를 가리키면 대역 도형. 노드 id·이름·설명은 앱이 붙인다: 스케치 object로 그리는 노드는 그 object의 이름·설명·primitive(`petal`, "Petal", 여럿이면 "Petal 2"), 나머지는 도형 종류로만(`Group`, `Group 2`, `Circle`, `Square 2`, "평범한 도형을 묶는 그룹" 등). 예제에는 스케치 요소로 그리는 노드 목록(`example.elements`)이 저장된다. 형제 노드는 부모 상자를 가로로 나눠 쓰고, carrier object는 자기 칸을 채우며, 다른 도형은 작은 하나로 둔다. transformation은 carrier에만 붙고 나머지 노드는 평범하게 그대로 둔다.
  - 펜은 예제의 구조나 대역 도형을 가지지 않는다. 펜에는 transformation, 알고리즘, 그리고 collection에 작용하는지 object에 작용하는지(`target`, 모델에는 `appliesTo`)만 있다. Compose는 `appliesTo`에 맞는 종류의 노드에 펜을 붙이고, 그 노드는 자기 모양을 유지한다.
  - 이전 형식(`subject`/`member`, `collection`/`object`, `target`/`primitive`, `standIn`)으로 저장된 AI 기록은 복원할 때 이 구조로 바꿔 읽는다(collection 대상이면 그룹 + 도형 하나, 아니면 도형 하나).
  - 예제 코드 지시문: "이 transformation만 carrier에 적용(collection이면 구성원 전체의 개수·위치·변화, object면 그 도형)하고 나머지 노드는 평범하게 그대로." 스케치 요소로 그리는 노드가 있으면(1차 예제): "이미지는 원본 스케치다. 그 노드들은 원본의 요소처럼(윤곽·비율·선·자기 색) 사본마다 평범한 한 개로 그려 원본과 닮게 하되, 이미지에서 다른 것(다른 배치·변화·색·움직임)은 가져오지 말 것. 나머지 object는 평범한 대역 도형. transformation은 연산만으로, 어떤 도형에도 그대로 작동하게 구현하고 요소는 자기 함수로 따로 그릴 것." 없으면(2차 이후): "object는 평범한 원/정사각형 대역(얇은 중립 윤곽, 채우기 없음), collection은 묶음일 뿐이며 스케치 요소가 아니므로 꽃잎 등 label이 암시하는 대상이나 다른 effect를 그리지 말 것."
  - 상태 머신은 없고, 그 transformation이 쓰는 알고리즘만 가져오며, 근거 영역의 비율을 유지한 채 프레임 가운데에 놓는다.
- 펜은 자동으로 만들지 않는다. transformation 예제 프레임 헤더나 우측 패널의 **Make pen**을 눌러야 그 예제로 펜이 생긴다(12절). 예제 코드는 **최대 세 개씩 동시에** 생성한다. 예제 코드는 그 예제 프레임만 보고(스케치 요소를 그리는 예제와 object 예제는 요소 모습을 위해 원본 스케치 이미지를 받음; 지시문 길이 한도는 4000자), "이 transformation 하나만, 평범한 대상에, 슬라이더가 눈에 보이게, 나중에 재사용할 수 있도록 함수로" 그리라는 지시로 만든다. 예제 프레임에서 나중에 Update해도 같은 지시를 쓴다(Generation direction이 있으면 덧붙임).
- 우측 패널 1단계에 이 스케치에서 나온 예제 목록과 상태(코드 생성 중·준비됨·오류·코드 없음)가 보이고, 누르면 그 예제로 간다. 다시 Decompose하면 새 예제가 또 생긴다(펜은 Make pen으로).
- 프레임 수는 최대 48개다. 자리가 없으면 남는 예제는 빼고 알려준다.
- 예제 프레임에서 값을 조절하거나 transformation을 다시 만들면 펜이 그 상태를 따라간다(12절).

### 5.1 최소 예제를 더 작게 나누기

- 최소 예제 프레임도 **Decompose**할 수 있다(프레임 헤더, 우측 패널 예제 머리의 **Decompose further**). 같은 `decompose` intent에 예제의 장면과 그 transformation(`targetNodeId`, `targetTransformationId`)을 함께 보내고, 서버는 문맥에 `split`(그 transformation의 현재 정의·값, 예제의 노드 구조와 carrier, 쓰는 알고리즘)을 넣는다. 이때 노드는 모두 대역 도형(`object: null`)으로 보낸다. 이미지는 그 예제의 결과 화면이다.
- 프롬프트는 그 transformation을 **2–6개의 더 작고 서로 독립적인 transformation**으로 나누라고 한다. 각 조각은 부모가 하는 일의 일부만 맡고, 부모의 현재 값과 알고리즘(같은 id)을 이어받는다. 조각도 연산만이고(요소의 모양 금지) 각자 가장 작은 예제 구조(`nodes`, `carrier`)를 부모 구조에서 필요한 만큼만 남겨 정한다. 서버가 보내는 `split`에는 transformation, 부모 예제의 노드 구조와 carrier, 알고리즘이 들어 있다.
- **2차부터는 스케치와 완전히 독립적이다.** 모델은 `objects`를 비워 두고 모든 object를 대역 도형으로 둔다. 서버도 split 결과에서는 `objects`를 버리고 노드의 `object`를 모두 `null`로 만든다. 그래서 더 작은 예제는 평범한 원·정사각형 위의 연산만 보여주고, object 예제는 생기지 않는다.
- **나누는 기준**(프롬프트): property뿐 아니라 알고리즘의 식과 인자 안에서도 따로 떼어낼 수 있는 측면을 찾는다(사본 수, 경로를 따른 간격, 경로 모양(직선→곡선, 곡률, 반지름), 방향, 번호별 변화, 요소 하나의 모양, 스타일, 움직임). 여러 측면을 정하는 알고리즘은 조각마다 단순한 알고리즘으로 나눈다. 사본이 있어야 보이는 연산(줄을 휘기, 크기 감소)도 따로 된 transformation이며, 예제는 평범한 사본 그룹 위에서 보여준다. 1차 Decompose의 독립성 규칙도 같은 기준으로 바꿨다(정말 한 숫자가 둘 다 정하는 경우만 하나로 둔다).
- **최소 단위**는 부모가 한 측면만 다룰 때뿐이다: 값 하나, 또는 같은 측면을 정하는 값들(한 색의 색상·채도 등)이고 여러 측면을 섞는 알고리즘이 없을 때. 개수+배치, 간격+곡률, 배치+변화는 항상 둘이다. 이때 모델은 부모와 같은 transformation 하나와 그 이유(`minimalReason`, 한 문장)를 돌려주고, 앱은 프레임을 만들지 않고 이유와 함께 "AI가 이미 최소 단위로 보고 나누지 않았다"고 알려준다(Generation direction에 나눌 방향을 적고 다시 할 수 있음).
- 결과는 스케치에서 Decompose할 때와 같다: 조각마다 최소 예제 프레임(부모 예제 오른쪽 격자)이 생기고 코드가 만들어진다(펜은 Make pen으로). 부모 예제와 그 펜은 그대로 남는다. 새 예제의 출처는 부모 예제다(보드 화살표 `smaller`).
- 몇 단계든 반복할 수 있다. 스케치의 예제 목록과 예제 머리의 목록은 더 작게 나눈 예제를 들여써서 트리로 보여준다. 깊은 예제에서 펜을 골라도 맨 처음 스케치로 화면을 옮긴다.
- AI history에서 이 기록을 복원하면 같은 방식으로 작은 예제와 펜이 생긴다(조각이 하나면 아무것도 만들지 않음).
- AI 재생성은 세 가지다: property 하나 다시 만들기, transformation 하나를 같은 id로 다시 만들기, 새 transformation을 AI가 제안해 스택 끝에 추가하기. 나머지 값은 유지하고, 겹치는 property id는 자동으로 바꾼다.
- **재생성은 버튼을 눌러도 바로 실행되지 않는다.** property·transformation의 ✦ 버튼이나 Add transformation with AI를 누르면 그 자리에 **Regenerate with AI** 입력 창이 열린다. 무엇이 대상인지(Property / Transformation / New transformation) 첨부 칩으로 보이고, 어떻게 바꿀지(또는 무엇을 더할지) 텍스트로 적는다. **Draw on frame**을 켜면 활성 프레임에 보라색으로 바꿀 곳을 그릴 수 있고(그 동안 스케치 획·레이어 선택은 꺼짐), "Annotation n획 첨부됨"으로 보이며 ×로 지운다. **Regenerate**를 누르면 텍스트(비어 있으면 프레임의 기존 지시), annotation 좌표, annotation을 그린 결과 이미지가 함께 AI(`transform`)에 간다. 성공하면 창이 닫히고, 실패하면 내용이 남아 다시 시도할 수 있다. Cancel로 닫는다. **재생성이 성공하면 그 프레임에 결과 코드가 있을 때 코드도 바로 다시 생성한다**(재생성된 transformation의 새 설명대로 예전 동작을 바꾸라는 지시와 함께). 그래서 장면 설명과 실행 중인 코드가 어긋나지 않는다. 예제 프레임에서 다시 만들면 그 예제의 펜도 새 transformation을 따라간다.

## 6. Layers 패널과 직접 조작


- 캔버스 왼쪽에 **Layers 패널**을 둔다. Collection/Object 트리, 이름 변경(더블클릭), 표시/숨김, 다중 선택(Shift/⌘), 드래그로 다른 Collection에 넣기·순서 바꾸기(같은 프레임 안), Group(⌘G)·Ungroup(⇧⌘G)·삭제·위/아래 이동, 새 Collection/Object, 레이어 Undo/Redo를 제공한다.
- 스케치 위에는 Collection(점선)·Object(실선) 영역과 이름 태그를 표시한다. Select 도구로 Figma처럼 처음 클릭하면 바깥 Collection, 다시 클릭하면 한 단계 안쪽이 선택되고, 드래그하면 멤버와 함께 움직인다. 화살표 키로 미세 이동, Delete로 삭제한다.
- 프레임 안에서 노드를 움직이면(Select 드래그, 화살표 키) **결과가 움직이는 대로 따라간다.** 드래그하는 동안 새 위치 값을 실행 중인 결과에 바로 보내 그 자리에서 다시 그리며(재생성·새로고침 없음), 놓을 때 한 번의 Undo 단계로 기록한다. 코드 생성 시 모든 노드를 위치 키로 배치하도록 지시한다.

## 7. 우측 패널

- 탭 없이 하나의 패널이다.
- 위에서부터: AI 진행·오류 표시, 블록 클립보드, **프레임 역할별 머리**, 라이브 연결 상태와 Generate/Update code, 실행 오류와 Fix with AI, 선택한 노드의 properties(또는 선택 안내), 블록 팔레트, Generation direction.
- 프레임 역할별 머리
  - **sketch**: workflow 세 단계. ① Decompose(버튼과 이 스케치의 예제 목록), ② Draw with pens(모든 transformation 펜, 눌러서 고르기), ③ Compose your sketch(Compose prompt, AI prompt 만들기, Compose sketch).
  - **minimal example**: 어떤 transformation을 어떤 대상에 보여주는지, 이 예제의 펜(눌러서 그리기, 아직 없으면 **Make pen**), 원본(스케치 또는 부모 예제)으로 가기, **Decompose further**와 이 예제에서 나눈 더 작은 예제 목록(5.1절).
  - **composition**: 어느 스케치에서 Compose했는지, 펜에서 가져온 transformation 목록(누르면 그 예제로, 예제가 지워졌으면 비활성), Compose prompt.
- 선택한 노드의 이름·설명, state 칩, 상태별 설명과 전이, 그리고 **semantic transformation 스택**(번호가 붙은 카드마다 이름·설명·도구·property 소켓·새 소켓)을 보여준다.

## 8. 코드 생성과 라이브 연결


- Generate code는 장면 전체(노드, transformation 스택, 블록, 머신)를 p5.js 코드로 만든다. 노드의 transformation은 순서대로 적용한다. 지시는 프레임 역할에 따라 다르다: 예제는 5절의 최소 예제 지시, composition은 Compose prompt, sketch는 Generation direction.
- composition처럼 펜에서 가져온 transformation이 있으면 그 최소 예제 프레임의 모듈 코드를 `references`로 함께 보낸다(예제 프레임이 남아 있을 때, 최대 12개). AI는 그 구현(도우미 함수와 값 읽는 방식)을 이 장면의 노드 id·키·박스에 맞춰 재사용한다.
- **코드는 처음부터 루트 노드(대부분 Collection)마다 독립된 모듈로 생성된다.** AI는 `rulegenModule("루트 id", function (m) { … return { setup, draw, mousePressed, … } })`만 루트마다 하나씩 쓴다. 알고리즘 함수·도우미·상태는 모두 그 모듈 안에 두고, 모듈끼리는 아무것도 공유하지 않는다(같은 알고리즘도 모듈마다 따로 정의).
  - 모듈은 `m`으로만 장면과 연결된다: `m.v("nodeId/propertyId…")` 값, `m.box("nodeId")` 위치·크기·표시 여부, `m.state("nodeId")` 현재 상태, `m.emit("nodeId", "transitionId")` 이벤트 전이, `m.p` p5. `m.store`는 인스턴스의 상태 객체로, 프레임 사이에 바뀌는 값(위치, 속도, 입자 배열, 잔상 기록 등)은 모두 여기에 일반 데이터로 둔다. 모듈 함수 바로 안에는 함수와 상수만 둘 수 있어서(`let`·배열·객체 금지), 호스트가 단계마다 상태를 저장·복원할 수 있다. 인자는 모두 문자열 리터럴이고 자기 모듈의 노드만 가리킬 수 있다.
  - 캔버스·루프·입력은 호스트가 맡는다: 900×600 캔버스를 만들고 매 프레임 지운 뒤 모듈마다 `draw`를 `push/pop` 안에서 부르고, 마우스·키·터치 입력을 모든 모듈에 나눠 준다. 모듈은 `p.setup`·`p.draw` 등 p의 속성을 바꾸거나 `background`·`createCanvas`·`noLoop` 등을 부를 수 없다.
  - 서버는 코드를 구문 분석해 이 계약을 검사한다(최상위에는 rulegenModule 호출만, 루트마다 정확히 하나, `m` 사용법, 자기 노드의 키·전이만, 모든 property 연결, 선언 안 한 전역 변수 금지). 어기면 거부하고 다시 생성한다.
  - 장면의 루트 노드 하나하나가 모듈의 **인스턴스**다. 인스턴스는 모듈 안의 노드 id를 실제 노드 id로 매핑하므로, 같은 모듈을 다른 노드 id로 여러 번 실행할 수 있다.
- 모든 scalar(중첩 블록의 인자 포함)는 `m.v("nodeId/propertyId/argId…")` 리터럴로 코드에 연결되어, 슬라이더를 움직이면 AI 호출 없이 결과가 바로 바뀐다. 노드 위치·크기·표시 여부(`m.box`)도 연결되어 레이어를 옮기거나 숨기면 결과도 바뀐다.
- 값만 바뀐 경우(슬라이더, 레이어 이동·숨김, 상태 값, 전이 시간)는 실행 중인 결과에 새 값을 보내 제자리에서 다시 그린다. 프로그램 자체가 바뀔 때만 다시 불러오며, 다시 불러오는 동안에도 이전 그림을 유지해 깜빡이지 않는다.
- 구조가 바뀌면(블록 교체, property 추가·삭제, 머신 변경) 상태가 *Structure changed*로 바뀌고 Update code로 다시 연결한다. 설명만 바뀐 경우도 알려준다.
- 생성 코드는 서버에서 AST로 검사한다: 모든 바인딩 사용, 리터럴 키만 허용, 값·상태 쓰기와 호스트 이름 재선언 금지, 잘못된 이벤트 금지, 머신이 있으면 `p.draw` 유지.
- 코드는 하단 **Raw p5.js** 패널에서 보고 복사·다운로드한다. 편집 버튼으로 코드를 고친 뒤 Run으로 실행하고, 실행 오류는 같은 패널과 우측 패널에서 Fix with AI로 고친다.
- 하단 패널(Code · State Machine)은 **위쪽 가장자리를 위아래로 끌어 높이를 조절**한다(↑/↓ 키로도, Shift와 함께 크게). 정한 높이는 두 탭에 똑같이 적용되고 이 브라우저에 기억되며, 더블클릭하면 기본 높이로 돌아간다.
- 생성 코드는 프레임마다 별도 sandbox iframe에서 실행하며 저장소·네트워크 접근이 없고 반복·재귀 실행 한도를 둔다. Pause는 상태 머신과 일반 애니메이션 루프를 모두 멈춘다.

## 9. Collection · Object별 state machine

- State machine은 프레임 전체가 아니라 **Collection 또는 Object마다** 따로 생긴다. 각 상태는 그 노드의 property 값만 바꾸고, 상태 값의 구조는 Base property와 같다.
- 머신은 **Compose**가 만든다: interaction pen 자국이나 prompt가 움직임·성장·사용자 입력을 말하는 노드에만 세밀한 머신을 준다(복잡한 interaction은 보통 8~20개 상태, 노드당 최대 32개 상태·128개 전이). 펜에서 가져온 transformation의 property도 상태 값으로 바꿀 수 있다(펜의 property id는 그대로 유지되고, 노드 자체 property가 겹치면 그쪽 이름을 바꾼다). 별도의 Generate/Refine state machine은 없다.
- 모든 전이는 이유를 말하는 semantic label을 가진다. 입력을 기다리는 상태는 실제 입력 이벤트로, 시간이 흐르는 단계만 timed 전이로 넘어간다. 여러 노드의 머신은 독립적으로 동작하고, 코드는 `m.state("nodeId")`, `m.emit("nodeId", "transitionId")`를 문자열 리터럴로 쓴다.
- 하단 **State Machine** 패널은 선택한 노드의 그래프를 보여준다(노드 선택기, 재생·일시정지·재시작, 현재 상태에서 가능한 이벤트 버튼). 그래프는 pan하고, state 박스·transition 라벨을 드래그로 옮기며(**Auto layout**으로 되돌림), state를 누르면 미리보기가 그 상태로 가고 우측 패널이 그 상태의 값으로 바뀐다. 그 동안 슬라이더 편집은 그 상태에만 적용되고, 상태 이름·설명과 나가는 전이(라벨·트리거·지연)도 우측 패널에서 고친다. 노드의 머신은 우측 패널에서 지울 수 있다.

## 10. 여러 스케치 프레임과 사진 붙여넣기


- 왼쪽 툴바에서 새 스케치 프레임을 추가한다. Decompose·Compose도 원본 옆에 새 프레임을 만든다. 각 프레임은 독립적인 그림·사진·Undo/Redo·장면·결과를 가진다.
- **여러 프레임 선택·삭제**: 선택 도구(V)로 빈 보드를 드래그하면 사각형이 그려지고, 닿은 프레임이 모두 선택된다(⇧+드래그는 기존 선택에 추가, ⇧+프레임 헤더 클릭은 하나씩 넣고 빼기). 선택한 프레임은 줌과 상관없이 같은 굵기의 초록 테두리로 보이고, 보드 위쪽에 "N개 프레임 선택됨 · 삭제 · 선택 해제" 막대가 뜬다. Delete/Backspace나 막대의 삭제로 한꺼번에 지운다(2개 이상이면 확인을 묻는다). AI 작업 중인 프레임은 지우지 않고 남기며, 예제 프레임의 펜은 한 개씩 지울 때처럼 지금 상태로 남는다. 선택된 프레임의 헤더를 끌면 선택한 프레임이 함께 움직인다. 빈 보드를 클릭하거나 Esc를 누르면 선택이 풀린다. 선택 도구에서 보드를 끌어 이동하려면 Space+드래그, 손 도구(H), 가운데 버튼을 쓴다.
- 보드 배치(프레임 위치와 화면 시점)는 프로젝트와 함께 저장되고 새로고침해도 그대로 돌아온다. 보드의 모든 변경(드래그, 확대, 맞춤)은 최신 배치에 적용하는 갱신으로 처리한다. 이전에는 페이지를 열 때 화면 맞춤이 복원 전의 빈 배치를 기준으로 덮어써서 프레임이 한 줄로 늘어서고 시점이 초기화됐다.
- 스케치 표면·제목·Focus 버튼을 클릭하면 그 프레임이 선택되고, 테두리와 제목이 초록색으로 강조된다.
- 사진 첨부·붙여넣기는 현재 선택된 프레임에 적용되고 그 프레임의 Undo/Redo에 포함된다. 프레임(본문이나 헤더)을 클릭해 선택한 뒤 ⌘/Ctrl+V로 이미지를 붙여넣으면 그 프레임에 들어간다. 프레임을 클릭해도 키보드 포커스가 생기지 않으므로 붙여넣기는 창 전체에서 받는다. 텍스트 입력창에서는 일반 텍스트 붙여넣기를 유지하고, 대화상자가 열려 있거나 AI 생성 중이면 무시한다.
- 프레임 그림·사진·위치는 프로젝트 저장·내보내기·불러오기에 포함한다. 예제·composition 프레임은 어느 스케치에서 나왔는지 기억하고 부제에 표시한다.

## 11. 프레임별 패널과 결과


- 프레임마다 역할(sketch·example·composition), 예제라면 어떤 transformation과 펜인지, 장면(노드·블록·머신), 선택, 상태 편집 위치, 생성 코드와 편집 중인 초안, Compose prompt, Generation direction을 따로 보관하고, 프레임을 선택하면 그 프레임의 패널로 전환한다.
- 각 프레임의 결과는 그 프레임 안에 그려지므로 여러 프레임의 결과를 동시에 본다. 슬라이더·코드 수정·Run/Pause·Interact·Re-render는 그 프레임에만 적용된다.
- 장면·결과 코드·프레임 위치는 저장·내보내기·불러오기에 포함하고, 실행 중 상태는 작업 중에만 프레임별로 유지한다.
- **AI 작업도 프레임별로 관리한다.** 요청·취소·진행 상태가 프레임마다 따로라서, 한 프레임에서 생성 중에 다른 프레임을 눌러도 그 생성은 끊기지 않고 끝까지 진행되어 그 프레임에 결과가 들어간다. 여러 프레임에서 동시에 생성할 수도 있다. 생성 중인 프레임은 헤더에 "AI 작업 중"이 보이고 ×로 그 프레임의 작업만 취소한다(하단 Cancel은 지금 프레임의 작업). 다른 프레임에 있는 동안 끝난 작업은 화면을 그 프레임으로 끌고 가지 않는다(Decompose·Compose로 생긴 새 프레임도 자리만 만들어진다). 프로젝트를 열거나 새로 만들 때만 모든 프레임의 작업을 멈춘다.

## 12. Transformation 펜과 Compose

- **Transformation 펜**은 최소 예제 하나에서 사용자가 **Make pen**(예제 프레임 헤더, 또는 우측 패널 예제 머리)을 눌러 만든다(AI 없음). Decompose나 AI 기록 복원은 펜을 만들지 않는다. 펜을 툴바에서 지우면 그 예제에 다시 Make pen이 보인다. 펜은 transformation 하나(이름·설명·property와 그 값), 그 대상(collection/object, member), 그 transformation이 쓰는 알고리즘을 담는다. 펜 색은 펜을 구분하는 표시일 뿐 결과 색이 아니다.
- **펜은 항상 최신이다.** 예제 프레임이 그 transformation을 가지고 있는 동안 펜은 그 프레임의 지금 상태(값 조절, AI regenerate 결과)를 읽는다. 툴바 펜, 그 펜으로 그린 획(획에는 그릴 때의 스냅샷이 남지만 같은 펜 id면 최신 상태로 읽음), Compose 요청이 모두 같다. 예제 프레임을 지우면 펜은 그때 상태로 고정되어 남는다. 저장할 때도 최신 상태를 저장한다.
- 펜으로 그린 자국은 "**이 transformation을 여기에**"라는 뜻이다. 연필로 형태·배치를 그리고 펜으로 적용할 곳을 표시한다. 펜 설정에서 색을 바꾸고, 툴바에서 지울 수 있다(이미 그린 획의 의미는 남음). 예제 프레임 헤더의 **Pen** 버튼이나 우측 패널의 펜 칩으로도 고른다. 예제·composition 프레임에서 펜을 고르면 원본 스케치로 화면을 옮긴다.
- **Compose sketch**(sketch 프레임 우측 패널 3단계)는 스케치 이미지, 순서가 있는 펜·연필·지우개 자국, 펜마다 transformation과 대상, Compose prompt를 AI(`compose`)에 보낸다. 모델에는 예제 프레임 id를 보내지 않는다.
  - AI는 장면을 만들면서 노드마다 적용할 펜 id 목록(`pens`)만 적는다. 앱이 그 펜의 transformation을 **예제에 있는 그대로**(property 값, 알고리즘 포함) 그 노드 스택 앞에 복사하고, 출처(`origin`: 예제 프레임, transformation id, 이름)를 남긴다. 펜 알고리즘 id가 AI가 쓴 다른 정의와 겹치면 펜 쪽 이름을 바꾼다.
  - 노드 자체 transformation은 펜이 다루지 않는 것(연필 경로를 따른 배치, 위치, 자기 모양)만 더한다. collection 대상 펜은 collection에, object 대상 펜은 object에 둔다.
  - 결과는 원본 옆의 새 **composition 프레임**에 담기고, 바로 코드를 생성한다(8절: 예제 코드를 `references`로 재사용).
- Compose prompt가 비어 있으면 AI(`compose-prompt`)가 스케치와 펜의 transformation을 읽고 한국어 bullet 초안을 먼저 채운다. **AI prompt 만들기/다시 만들기**로 설명만 생성·갱신할 수 있고, 요청 중 사용자가 고친 prompt는 덮어쓰지 않는다.

## 13. Interaction pen


- 사용자 interaction을 스케치에 annotate하는 **Interaction pen**을 기본 제공한다. 클릭·탭 대상, 호버 영역, 드래그 경로와 방향, 놓기 위치, 키 입력 반응을 그린다.
- 펜 설정에서 semantic과 색을 편집하며, 이미 그린 획은 그릴 때의 의미를 보관한다. Erase·Undo·Redo를 지원하고 저장·불러오기·AI 로그 복원에 포함한다.
- AI prompt 작성, Decompose·Compose, 코드 생성에 이 획의 좌표·의미를 함께 보낸다. AI는 annotation을 그림으로 복제하지 않고 입력 대상·동작·반응으로 해석해, 대상 노드의 머신과 실제 p5 입력 callback·위치 검사로 연결한다.

## 14. 실제 엔진과 LLM 연결


- 스케치와 결과 실행에는 p5.js 엔진을 쓴다.
- Decompose, transformation·property 재생성, 코드 생성, Compose와 prompt 초안에 실제 LLM을 연결한다(intent: `decompose`, `transform`, `code`, `compose`, `compose-prompt`). 모델은 `OPENAI_MODEL`(기본 `gpt-6.1-sol`).
- 환경 파일은 서버에서만 읽고 API 키를 브라우저에 노출하지 않는다.

## 15. 프롬프트 폴더


- 모든 AI 프롬프트는 프로젝트 루트 **`prompts/`**에 Markdown으로 둔다. 의도마다 한 파일(`decompose`, `compose`, `compose-prompt`, `transform`, `code`)이고, 공통 규칙은 `prompts/contracts/`(scene 모델, state planning, scene 코드 계약, interaction annotation)에서 `{{include:…}}`로 포함한다.
- 각 프롬프트 파일 끝에 **출력 JSON 형식과 예시**를 적고, 서버가 실제로 보내는 strict JSON Schema를 `prompts/schemas/<intent>.json`에 둔다. 스키마를 바꾸면 `npm run prompts:schemas`로 다시 쓰고, 파일이 실제 스키마와 다르면 테스트가 실패한다.
- 서버는 요청마다 프롬프트 파일을 다시 읽어 재시작 없이 반영한다. `RULEGEN_PROMPT_DIR`로 위치를 바꿀 수 있고 Docker 이미지에도 포함한다.

## 16. AI 생성 로그와 복원


- 모든 AI 생성 요청을 서버의 `ai-generations/<날짜>/<시각-의도-ID>/`에 저장한다: 입력 이미지, 사용자 입력, AI에 보낸 prompt, 원본 응답, 최종 검증 결과, 코드는 `generated.js`, 모델·시간·상태·소요 시간·token 사용량. 실패·취소도 기록하고, API 키와 인증 헤더는 저장하지 않는다. 폴더는 Git에서 제외하며 `RULEGEN_AI_LOG_DIR`로 위치를 바꾼다. AI를 부르지 않는 로컬 편집(블록 끼우기, 펜 만들기, 슬라이더, 레이어 편집)은 기록하지 않는다.
- 상단 **AI history**에서 기록을 조회하고(종류·시각·모델·상태), 결과와 오류를 확인하고 JSON으로 내려받는다.
- 완료된 생성은 **이 생성 복원하기**로 AI 재호출 없이 복원한다. 새 생성은 `context.json`(생성 직전 프로젝트와 대상 프레임)과 `recovery.json`(복원용 프로젝트)을 함께 저장한다. Decompose 기록은 그 예제 프레임들(코드 없이, 펜 없이)을, Compose 기록은 새 composition 프레임을 복원한다. 보드도 그때 모습으로 돌아온다: 프레임 위치와 화면 시점(camera, 확대 배율)을 그대로 복원하고, 시점이 없는 옛 기록만 대상 프레임으로 화면을 옮긴다. 복원은 현재 로컬 초안을 교체하므로 먼저 Export project로 내보내도록 안내한다.
- OpenAI의 일시적 오류(과부하 503, 500/502/504, 요청 한도 429)는 2초·4초·8초 간격으로(Retry-After가 있으면 그 값) 최대 3번 자동 재시도한다. 사용 한도 소진(`insufficient_quota`)이나 키·모델 오류는 재시도하지 않는다. 재시도한 응답은 `response-<회차>-retry<n>.txt`와 `log.json`의 `retries`에 남는다.
- **오류 로그**: 화면에 뜨는 모든 오류를 `error-logs/<날짜>/<시각-출처-ID>.json`에 하나씩 저장한다(Git 제외, `RULEGEN_ERROR_LOG_DIR`로 위치 변경). 출처는 `ai`(AI 생성 실패: 의도·모델·HTTP 상태·OpenAI 오류 코드·`ai-generations/` 생성 폴더 키), `prepare`(코드 안전 검사 실패와 그 코드), `runtime`(생성 코드를 브라우저에서 실행할 때 난 오류와 그 코드), `ui`(그 밖에 프레임에 표시된 오류), `server`(요청 형식 등)다. API 키는 지우고, 이미지 data URL은 길이만 남긴다. 서버가 이미 기록한 오류는 브라우저에서 다시 기록하지 않는다.
- 실패·취소 기록은 복원하지 않는다. 로그 폴더 밖 파일 접근을 막고 이미지 참조와 복원 형식을 검증한다.

## 17. 프레임 삭제


- 각 프레임 헤더의 휴지통 버튼으로 프레임을 삭제한다. 프레임을 삭제하면 그림·사진·장면·결과·패널·Undo/Redo·선택 상태를 함께 정리하고, 다른 프레임은 유지한다(예제·composition 프레임은 원본과 독립적이다). 예제 프레임을 지우면 그 펜은 그때 상태로 남는다.
- 선택된 프레임을 삭제하면 남은 프레임으로 선택을 옮긴다. 기본 원본 스케치도 삭제할 수 있으며(내용을 비우고 숨김) **Add sketch frame**으로 다시 표시한다.
- 삭제 상태는 로컬 저장과 JSON 내보내기·불러오기에 반영한다. 그 프레임이 AI 생성 중일 때는 그 프레임의 삭제를 막고(다른 프레임은 삭제할 수 있고 그 프레임들의 생성은 계속된다), 오래된 비동기 결과가 삭제된 프레임을 되살리지 않게 한다.

## 18. 결과와 상호작용

- 결과 annotation·수정 제안, Inspection, direct manipulation handle은 이 브랜치에 없다. 결과는 슬라이더, AI regenerate(5절), 코드 편집·Fix with AI로 고친다.
- 결과를 직접 써 보려면 프레임 헤더의 **Interact**를 누른다(1절).

## 19. 이전 형식 호환 없음

- 이전 형식은 지원하지 않는다. 프로젝트 형식은 `version: 2`다.
- 저장된 프로젝트를 열 때 예전 종류의 펜(알고리즘 펜)은 툴바에서 빠지고, 그 펜으로 그린 획은 일반 연필 선으로 남는다. 예전 brush·proxy frame·inspection 데이터는 무시한다. 예전 의도(extract·inspect·handles·revision·state-machine 등)의 AI 로그는 복원하지 않는다.
- Transformation 펜은 `transformation: { frameId, nodeId, subject, member, transformation, library }`를 저장한다.

## 20. 생성 코드의 `top` API 오인 오류 수정


- 반복 오류 **`코드에서 지원하지 않는 API: top`**은 생성 코드의 모든 `top` 식별자를 금지 API로 본 검사 방식 때문이었다(예: `const top = 28`).
- 코드 검사는 선언과 사용 범위를 확인한다. 코드 안의 지역 변수·함수 파라미터가 `top`, `parent` 등과 이름이 같아도 허용하고, 선언되지 않은 전역 접근(`window.top`, 전역 `parent`)과 금지된 속성 접근(`p.top`, `p["top"]`), `eval`·`Function`·`constructor`·`__proto__`·`prototype`은 계속 차단한다. 반복·재귀 실행 한도도 유지한다.

## 21. 코드 구조(모듈화)

- `app/lib/scene/`: schema(모델), values(바인딩·슬라이더), algorithms(블록 라이브러리·재사용·가져오기), transfer(블록 복사·붙여넣기·드롭), graph(레이어 트리 연산), machines(노드별 상태와 런타임 블록), convert(AI 출력 → 장면, Compose의 펜 transformation 복사), minimal-example(decompose 결과, 최소 예제 장면과 지시), validate, live, panel-ops(패널 단위 순수 편집 함수)
- `app/lib/algorithm-pens.ts`: interaction pen, 예제에서 펜 만들기(`examplePen`), 예제를 따라가는 펜(`livePen`), Compose 문맥
- `app/server/`: `intents.server.ts`(의도별 스키마·전처리·후처리), `prompts.server.ts`, `scene-code.server.ts`(AST 검사와 호스트 블록 연결), `code.server.ts`(실행 안전 검사), `ai.server.ts`(전송·재시도·로그)
- `app/studio/`: 라우트와 분리한 액션 레이어(`scene-actions.ts`: 장면 편집, Decompose, Compose, 코드 생성과 예제 코드 참조, regenerate)
- `app/components/`: `workflow-panels.tsx`(역할별 우측 패널 머리), `scene/`(Layers, Property 패널, 소켓·블록 편집기, 블록 팔레트, 장면 오버레이, 노드 상태 그래프), `frame-render.tsx`, `code-preview.tsx`, `tool-rail.tsx`, `raw-code-panel.tsx`
- `app/lib/workspace.ts`: 프레임 배치(새 프레임은 원본 옆 빈 자리, 예제는 격자)

## 22. 렌더링 시간 제한(Rendering budget)


- 생성 코드의 모든 반복문·함수에는 안전 장치(`__rulegenGuard`)가 들어간다. 예전에는 한 프레임에 10만 번을 넘으면 "Rendering budget exceeded. Reduce loops or recursion." 에러로 멈췄다.
- 입력 history에서 매 프레임 다시 그리는 방식(DERIVE FROM THE INPUT)에서는 정상 코드도 이 횟수를 쉽게 넘었다. 예: 하트 trail은 하트 하나에 약 700번, 하트가 많아지면 한 프레임에 약 39만 번. 그래서 무한 루프가 아닌데도 에러가 자주 났다(오류 로그에 하루 수십 건).
- 이제 **시간으로** 판단한다: 한 프레임(또는 입력 이벤트·메시지 하나)이 **10초** 넘게 끝나지 않을 때만 멈춘다(처음 2초에서 10초로 늘렸다). 무거워도 끝나는 프레임은 그대로 그린다. 매 프레임, 입력 이벤트마다 시계를 다시 시작한다(`app/lib/render-guard.ts`).
- **프레임 비용이 입력 전체와 함께 커지지 않게 했다.**
  - 문제: Sketch 8 수풀 brush는 캐시 키를 입력 기록 전체(`JSON.stringify(history)`)로 만들었다. 드래그 중에는 점이 늘 때마다 키가 바뀌어 매 프레임 모든 드래그의 수풀과 겹친 선 지우기(선분마다 근처 수풀 안인지 검사)를 처음부터 다시 했다. 수풀이 쌓이면 한 프레임이 2초를 넘었다.
  - `m.history()`의 드래그마다 **`id`**(바뀌지 않고 다시 쓰이지 않음)와 **`rev`**(점이 추가되거나, 손을 떼거나, 점이 솎아질 때마다 바뀜)가 붙는다. 같은 `id`·`rev`면 점도 같다. inspection 단계 복원 뒤에도 그대로이고, 새 드래그는 새 id를 받는다.
  - **`m.memo(key, () => 값)`**: 모듈의 host 캐시. key(짧은 문자열이나 작은 배열)마다 한 번만 계산한다. `m.store` 밖에 있어 저장되는 상태 snapshot에 복사되지 않는다. 한동안 쓰이지 않은 항목은 지우고(240프레임), 모듈당 4000개까지 둔다. 2000자보다 긴 key(점이나 기록 전체로 만든 key)는 오류로 막는다.
  - 코드 계약: 드래그 하나가 만드는 것은 `m.memo`로 그 드래그의 `id`·`rev`와 쓰는 값으로 한 번만 계산한다. 끝난 드래그는 다시 계산하지 않고, 드래그 중에는 그 드래그만 다시 계산한다. 값이 바뀌면 드래그마다 한 번씩 다시 계산한다. 여러 드래그에 걸친 계산(겹침, 가려진 선, 충돌)은 앞 드래그들의 결과를 바탕으로 드래그마다 나눠 계산하고, 격자나 경계 상자로 근처만 비교한다. 기록 전체를 key로 쓰거나 `JSON.stringify`하지 않는다. `m.store`에는 상태와 그린 항목의 가벼운 목록(위치·크기)만 두고 윤곽 점이나 캐시는 두지 않는다. 도형은 path 하나로 그리고 그리기 호출은 프레임당 수천 개 이내.
  - 이 에러가 나면 메시지에 "드래그마다 m.memo로 한 번만 계산하라"는 안내가 들어가 **Fix with AI**가 그 방향으로 고친다. "Update code to adjust in place" 지시에도 같은 내용을 넣었다.
  - 이미 생성된 코드는 그대로이므로, 그 프레임에서 Fix with AI나 Update로 다시 생성해야 빨라진다.

## 주요 사용 흐름

1. 스케치 프레임에 연필로 그리거나 사진을 붙인다.
2. **Decompose**를 누른다. 스케치 오른쪽에 스케치의 object마다, 그리고 transformation마다 최소 예제 프레임이 생기고(transformation 예제는 원본 요소로 그려져 원본과 닮음), 예제 코드가 차례로 만들어진다. 쓸 transformation 예제에서 **Make pen**을 눌러 펜을 만든다.
3. 예제 프레임에서 슬라이더로 값을 맞추거나, transformation을 AI로 다시 만든다. 펜이 그 상태를 따라간다.
4. 새 스케치 프레임을 추가하고(또는 원래 스케치에) 연필로 형태와 배치를, transformation 펜으로 적용할 곳을 그린다.
5. 우측 패널 3단계에서 **Compose sketch**를 누른다(처음에는 AI가 prompt 초안을 채움 → 확인·수정 → 다시 Compose sketch). 새 composition 프레임에 장면과 결과가 생긴다.
6. composition에서 값을 조절하고, **Interact**로 써 보고, 필요하면 예제로 돌아가 고친 뒤 Update한다.

## 검증

- 단위 테스트(전체 87개 통과): decompose 결과 변환과 id 정리, 프롬프트·스키마 사용, collection/object 예제 구조(한 개·여러 개·중첩, 사본 그룹의 Count property·Copies 보충과 이미 개수가 있으면 추가하지 않음, 자식이 부모 안에 놓임, 깨진 구조 정리, 스케치 요소 이름이 들어가지 않음, 옛 기록 형식 변환, 펜의 appliesTo, 알고리즘·머신 없음, 지시문), 펜이 예제 프레임의 최신 값을 따라가고 프레임이 사라지면 저장된 복사본을 쓰는 것, 같은 펜의 획이 Compose 문맥에서 하나로 묶이는 것, 예전 펜 형식 정리, Compose에서 펜 transformation을 그대로 복사하고 origin을 남기는 것(id 충돌 시 노드 자체 쪽 이름 변경, 알고리즘 id 충돌 시 펜 쪽 이름 변경, 펜 property를 상태 값으로 쓰기), 모델에 예제 프레임 id를 보내지 않는 것, composition 코드 생성에 예제 모듈 코드를 `references`로 보내는 것, Decompose 액션이 예제 프레임·펜을 만들고 예제 코드를 각자 생성하는 것(만든 코드가 실행되는 것까지), Compose 액션이 새 composition 프레임을 만드는 것, AI history 복원(decompose → 예제·펜, compose → composition 프레임), 최소 예제를 다시 Decompose할 때 모델에 `split` 문맥이 가고 작은 예제가 부모 예제를 출처로 생기며 더 나눌 수 없으면 아무것도 만들지 않는 것(복원 포함). 그 밖에 코드 계약·모듈·런타임·로그·레이어 편집 테스트.
- Headless Chrome에서 AI 응답만 가짜로 넣어 전체 흐름을 확인했다: 스케치 → Decompose → 예제 프레임 3개(모두 준비됨)와 펜 3개 → 새 스케치에 Radial repetition 펜과 연필로 그리기 → Compose sketch(AI prompt 초안 → Compose) → composition 프레임 생성, 펜 transformation이 들어가고 코드 요청에 예제 코드가 참조로 포함됨.
- 실제 AI가 transformation을 얼마나 독립적으로 나누는지, 예제 코드를 composition에서 얼마나 잘 재사용하는지는 아직 확인하지 못했다.
