# Rulegen 요구사항 V2 (최신본)

최종 갱신: 2026-10-13

`init.md` 원문과 이후 대화에서 요청한 내용을 현재 동작 기준으로 하나로 정리한 문서입니다. 예전 요청 중 지금의 동작과 맞지 않는 내용(visual feature 태그, subfeature·rule widget, Features/Rules/Code/Brush 탭, 프레임 단위 state machine, procedural brush 생성, 스케치와 분리된 generated result 프레임)은 지우고 최신 요구사항으로 덮어썼습니다. 이전 형식 호환은 지원하지 않습니다(19절).

# Overview

Hand-drawn sketch를 creative coding으로 옮기는 과정을 탐색하며 할 수 있도록 돕는 툴이다. 스케치에서 **Collection과 Object**를 추출하고, 그 안의 semantic transformation과 **알고리즘 블록**을 조절·재조합해 p5.js 결과를 만든다.

---

## 1. 작업 공간과 프레임 모델

- 작업 공간은 freeform 무한 캔버스다. 캔버스를 이동·확대·축소하고 프레임을 자유롭게 배치한다.
- **프레임은 한 가지 모델(스케치 프레임)뿐이다.** 결과 전용 프레임은 없다. 모든 프레임은 스케치할 수 있고, 자기 장면(Collection·Object)과 그 장면의 **generated result를 같은 프레임 안에** 그린다. 층은 아래부터 생성 결과 → 스케치 획과 레이어 박스 → (annotation 중이면) annotation이다.
- 직접 스케치하는 입력과 사진 첨부(파일 업로드, 드롭, 클립보드 이미지 붙여넣기)를 지원한다. 스케치 프레임 배경은 흰색이다.
- 기본 스케치 도구: 연필(색·굵기·투명도), 지우개, 라쏘, 이동(pan), 확대·축소, Undo/Redo.
- 프레임 헤더에서 프레임마다 결과를 제어한다: **Run / Pause**(애니메이션·상태 머신 재생과 정지), **Re-render**(처음부터 다시 그리기), **Generate / Update**(코드가 없거나 구조가 바뀐 경우), **Annotate**, **Extract**.

## 2. 왼쪽 툴바

- 작업 도구와 캔버스 조작 도구는 왼쪽 툴바에 모은다: 스케치 프레임 추가, 사진 첨부, **Select(V)**, 연필(P), 지우개(E), 라쏘(L), 이동(H), 알고리즘 펜·Interaction pen, Undo/Redo/지우기, 확대·축소.
- 연필의 색상·굵기·투명도 메뉴는 연필을 눌렀을 때만 연필 버튼 옆 팝오버로 나타난다.
- Select 도구로 스케치 위의 Collection·Object를 선택하고 움직인다(6절).

## 3. Collection · Object 모델

### Collection
- Figma나 PowerPoint의 Group처럼 여러 Object와 다른 Collection을 묶는다. 묶인 노드는 같이 선택되고 같이 움직인다.
- Group과 달리 **semantic transformation**을 가진다. 하나의 Collection에 semantic transformation을 **여러 개 쌓을 수 있다**(3.1). 각 transformation의 property에 따라 멤버 전체에 spatial(위치·배치·크기·분기), stylistic(색·굵기·질감), temporal(속도·타이밍·성장) effect가 적용된다.
- Collection 안에 Collection을 넣을 수 있다(예: 나무 → 가지 세대 → 잎). Collection 영역은 자기 영역과 멤버를 모두 감싼다.

### Object
- 가장 기본적인 primitive(획, 도형, 점, 곡선 등)다.
- Collection처럼 여러 semantic transformation과 그 property를 가진다.
- Collection 안에 포함되거나 루트에 단독으로 배치된다.

### 3.1 Semantic transformation 스택
- 노드(Collection·Object)마다 semantic transformation을 **순서 있는 목록**으로 가진다(노드당 최대 6개). 위에서 아래 순서로 적용되고, 뒤의 것은 앞의 결과 위에 쌓인다. 예: 꽃 Collection = ① Radial bloom(꽃잎 배치) → ② Wind sway(시간에 따라 흔들림) → ③ Fading palette(색).
- 각 transformation은 고유 id, 이름, 설명, property 목록(최대 8개)을 가진다. 서로 다른 의미는 서로 다른 transformation으로 나누고, 한 가지 의미뿐이면 하나만 둔다. 반복(`count` + 배치 블록)도 하나의 transformation으로 둔다.
- Property id는 노드 전체에서 고유하다(노드당 property 최대 16개). 그래서 라이브 키는 transformation과 무관하게 `nodeId/propertyId…`이고, state machine 값도 property id만으로 가리킨다.
- 우측 패널에서 transformation을 추가(빈 것 또는 **Add transformation with AI**), 이름·설명 수정, ↑↓로 순서 변경, AI로 다시 만들기, 삭제(그 property와 상태 값도 함께 삭제)할 수 있다. 블록은 원하는 transformation의 소켓에 끼우거나 드롭한다. 상태 편집 중에는 스택 구조를 바꿀 수 없다.
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
- **Procedural economy**: Collection·Object를 마구 늘리지 않는다. 노드 수는 마크 수가 아니라 서로 다른 *종류*의 수로 정한다(단순한 마크는 1~2개, 풍부한 이미지도 대개 8개 이하, AI 응답은 최대 16개).
  - 공통 특징을 가진 요소(꽃잎, 잎, 점, 벽돌, 가지, 물결, 해칭 선, 흩뿌린 자국 등)는 크기·색·회전·위치가 달라도 **하나의 노드**로 만들고, 그 region이 모든 인스턴스를 덮는다. 반복은 semantic transformation이 **procedural하게 생성**한다: `count` + 배치 알고리즘(row·grid·radial·scatter·along-path·recursive 등) + 인스턴스 번호·깊이·노이즈에 따른 알고리즘 변화(크기는 power-decay, 색은 palette 등).
  - 부분이 있는 반복 단위(꽃 = 꽃잎 + 꽃술)는 Collection 하나로 만들고 그 Collection의 transformation이 복제한다. 종류나 역할이 다르거나, 따로 선택·이동해야 하거나, 자기 state machine이 필요할 때만 노드를 나눈다. 같은 로직은 하나의 블록을 id로 재사용한다.
  - 서버가 결과를 검사한다: 같은 부모 아래 구조가 같은(종류·primitive·property 효과/구조·자식 구조가 같은) 형제가 3개 이상이거나, 번호만 다른 형제가 2개면 위반이다(state machine이 있는 노드는 제외). 위반하면 AI에 무엇이 반복됐는지 알려 **한 번 다시 쓰게** 하고, 그래도 위반하면 첫 노드 하나로 합치고 관찰된 배치에서 추론한 `repeat-layout` 블록(count·arrangement(row/column/grid/radial/scatter)·spacing·size·jitter)을 `Repeat` property로 끼운다. Compose와 수정 제안(새로 추가된 노드만)에도 같은 규칙을 적용한다.
  - 코드 생성은 한 노드가 여러 인스턴스를 뜻한다는 것을 알고, count·배치 블록으로 모든 인스턴스를 노드 영역 안에 그린다.
- 원본 스케치가 바뀌면 추출된 프레임에 다시 추출하라는 안내를 표시한다. 다시 Extract하면 또 하나의 새 프레임이 생긴다.
- AI 재생성은 세 가지다: property 하나 다시 만들기, transformation 하나를 같은 id로 다시 만들기, 새 transformation을 AI가 제안해 스택 끝에 추가하기. 나머지 값은 유지하고, 겹치는 property id는 자동으로 바꾼다.

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
- 모든 scalar(중첩 블록의 인자 포함)는 `rulegenParams["nodeId/propertyId/argId…"]` 리터럴로 코드에 연결되어, 슬라이더를 움직이면 AI 호출 없이 결과가 바로 바뀐다. 노드 위치·크기·표시 여부(`nodeId/@x|@y|@w|@h|@visible`)도 연결되어 레이어를 옮기거나 숨기면 결과도 바뀐다.
- 값만 바뀐 경우(슬라이더, 레이어 이동·숨김, 상태 값, 전이 시간)는 실행 중인 결과에 새 값을 보내 제자리에서 다시 그린다. 프로그램 자체가 바뀔 때만 다시 불러오며, 다시 불러오는 동안에도 이전 그림을 유지해 깜빡이지 않는다.
- 구조가 바뀌면(블록 교체, property 추가·삭제, 머신 변경) 상태가 *Structure changed*로 바뀌고 Update code로 다시 연결한다. 설명만 바뀐 경우도 알려준다.
- 생성 코드는 서버에서 AST로 검사한다: 모든 바인딩 사용, 리터럴 키만 허용, 값·상태 쓰기와 호스트 이름 재선언 금지, 잘못된 이벤트 금지, 머신이 있으면 `p.draw` 유지.
- 코드는 하단 **Raw p5.js** 패널에서 보고 복사·다운로드한다. 편집 버튼으로 코드를 고친 뒤 Run으로 실행하고, 실행 오류는 같은 패널과 우측 패널에서 Fix with AI로 고친다.
- 생성 코드는 프레임마다 별도 sandbox iframe에서 실행하며 저장소·네트워크 접근이 없고 반복·재귀 실행 한도를 둔다. Pause는 상태 머신과 일반 애니메이션 루프를 모두 멈춘다.

## 9. Collection · Object별 state machine

- State machine은 프레임 전체가 아니라 **Collection 또는 Object마다** 따로 생긴다. 각 상태는 그 노드의 property 값만 바꾸고, 상태 값의 구조는 Base property와 같다(숫자는 숫자, 같은 블록의 같은 인자).
- 선택한 노드의 **Generate / Refine state machine**으로 AI가 상태를 세밀하게 계획한다. 복잡한 interaction은 보통 8~20개 상태, 노드당 최대 32개 상태·128개 전이. 대기·접근·누름·드래그·놓기·정착·완료·취소·복귀처럼 입력이나 동작이 달라지는 경계를 나누고, 같은 동작의 프레임만 늘리지 않는다. 정적인 노드는 머신이 없다.
- 모든 전이는 이유를 말하는 semantic label을 가진다(예: **원 위에 포인터 진입**, **드래그 시작**, **유효한 영역에 놓기**, **성장 완료**). 입력을 기다리는 상태는 실제 입력 이벤트로, 시간이 흐르는 단계만 timed 전이로 넘어간다.
- 여러 노드의 머신은 동시에 독립적으로 동작한다. 코드는 `rulegenState["nodeId"]`로 노드별 상태를 읽고 `rulegenEmit("nodeId", "transitionId")`로 이벤트를 보낸다.
- 하단 **State Machine** 패널은 선택한 노드의 그래프만 보여준다(노드 선택기, 재생·일시정지·재시작, 현재 상태에서 가능한 이벤트 버튼, 그래프 위 전이 라벨과 툴팁).
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
- 완료된 생성은 **이 생성 복원하기**로 AI 재호출 없이 복원한다. 새 생성은 `context.json`(생성 직전 프로젝트·대상 스케치·라쏘 영역·annotation·clarification·검토 중 제안)과 `recovery.json`(복원용 프로젝트)을 함께 저장한다. 미확정 제안은 검토 상태로 복원하고 자동 적용하지 않는다. 복원은 현재 로컬 초안을 교체하므로 먼저 Export project로 내보내도록 안내한다.
- OpenAI의 일시적 오류(과부하 503, 500/502/504, 요청 한도 429)는 2초·4초·8초 간격으로(Retry-After가 있으면 그 값) 최대 3번 자동 재시도한다. 사용 한도 소진(`insufficient_quota`)이나 키·모델 오류는 재시도하지 않는다. 재시도한 응답은 `response-<회차>-retry<n>.txt`와 `log.json`의 `retries`에 남는다.
- **오류 로그**: 화면에 뜨는 모든 오류를 `error-logs/<날짜>/<시각-출처-ID>.json`에 하나씩 저장한다(Git 제외, `RULEGEN_ERROR_LOG_DIR`로 위치 변경). 출처는 `ai`(AI 생성 실패: 의도·모델·HTTP 상태·OpenAI 오류 코드·`ai-generations/` 생성 폴더 키), `prepare`(코드 안전 검사 실패와 그 코드), `runtime`(생성 코드를 브라우저에서 실행할 때 난 오류와 그 코드), `ui`(그 밖에 프레임에 표시된 오류), `server`(요청 형식 등)다. API 키는 지우고, 이미지 data URL은 길이만 남긴다. 서버가 이미 기록한 오류는 브라우저에서 다시 기록하지 않는다.
- 반복 노드 검사로 다시 요청한 경우 두 번째 prompt·응답도 `prompt-2.json`·`response-2.json`으로 함께 저장한다. 실패·취소 기록은 복원하지 않는다. 로그 폴더 밖 파일 접근을 막고 이미지 참조와 복원 형식을 검증한다.

## 18. 프레임 삭제

- 각 프레임 헤더의 휴지통 버튼으로 프레임을 삭제한다. 프레임을 삭제하면 그림·사진·장면·결과·패널·Undo/Redo·선택 상태를 함께 정리하고, 다른 프레임은 유지한다(추출된 프레임은 원본과 독립적이다).
- 선택된 프레임을 삭제하면 남은 프레임으로 선택을 옮긴다. 기본 원본 스케치도 삭제할 수 있으며(내용을 비우고 숨김) **Add sketch frame**으로 다시 표시한다.
- 삭제 상태는 로컬 저장과 JSON 내보내기·불러오기에 반영한다. AI 생성 중에는 삭제를 막고, 오래된 비동기 결과가 삭제된 프레임을 되살리지 않게 한다.

## 19. 이전 형식 호환 없음

- 이전 형식(visual feature·rule widget, 프레임 단위 state machine, brush 레시피, 별도 결과 프레임, 예전 펜 스냅샷)은 지원하지 않는다. 변환 코드는 모두 지웠다.
- 프로젝트 형식은 `version: 2`다. 이전 형식의 로컬 저장본·JSON은 열지 않고 새 작업실을 연다. 예전 의도(analyze·rules·subfeature·brush)의 AI 로그는 복원하지 않는다.
- Semantic pen은 블록(`algorithm: { call, library }`)과 출처(`source: { nodeId, label }`)만 저장한다.

## 20. 생성 코드의 `top` API 오인 오류 수정

- 반복 오류 **`코드에서 지원하지 않는 API: top`**은 생성 코드의 모든 `top` 식별자를 금지 API로 본 검사 방식 때문이었다(예: `const top = 28`).
- 코드 검사는 선언과 사용 범위를 확인한다. 코드 안의 지역 변수·함수 파라미터가 `top`, `parent` 등과 이름이 같아도 허용하고, 선언되지 않은 전역 접근(`window.top`, 전역 `parent`)과 금지된 속성 접근(`p.top`, `p["top"]`), `eval`·`Function`·`constructor`·`__proto__`·`prototype`은 계속 차단한다. 반복·재귀 실행 한도도 유지한다.

## 21. 코드 구조(모듈화)

- `app/lib/scene/`: schema(모델), values(바인딩·슬라이더), algorithms(블록 라이브러리·재사용·가져오기), transfer(블록 복사·붙여넣기·드롭, 레이어 다른 스케치로 복사), graph(레이어 트리 연산), machines(노드별 상태와 런타임 블록), convert(AI 출력 → 장면), validate, revisions, pens, procedural(반복 노드 검사·병합), live, panel-ops(패널 단위 순수 편집 함수)
- `app/server/`: `intents.server.ts`(의도별 스키마·전처리·후처리·결과 검토), `prompts.server.ts`(프롬프트 로더), `scene-code.server.ts`(AST 검사와 호스트 블록 연결), `code.server.ts`(실행 안전 검사), `ai.server.ts`(전송·검토 후 1회 재요청·로그)
- `app/studio/`: 라우트와 분리한 액션 레이어(장면 편집·블록 복사/붙여넣기/드롭, AI 생성, 결과 revision)
- `app/components/scene/`: Layers, Property 패널, 소켓·블록 편집기, 블록 팔레트, 우클릭 메뉴, 장면 오버레이, 노드 상태 그래프 · `frame-render.tsx`: 프레임 안의 결과 층과 annotation 층 · `code-preview.tsx`: sandbox 실행과 값 실시간 반영 · `tool-rail.tsx`: 왼쪽 툴바 · `raw-code-panel.tsx`: 하단 코드 보기·편집
- `app/lib/workspace.ts`: 프레임 배치(새 프레임은 원본 옆 빈 자리)

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

## 검증

- 블록 복사·붙여넣기(다른 스케치 포함, 같은 id 다른 정의는 이름 변경, 중첩 한도), 블록 드롭으로 새 property 만들기, 레이어를 다른 프레임으로 복사(멤버·블록·머신·id 충돌)한 뒤 그 프레임 안의 결과 생성, 같은 프레임 내 이동(재생성 없음), Extract가 새 프레임을 만들고 원본 스케치를 문맥으로 결과를 생성하는 흐름, 값만 바뀔 때 프로그램이 같게 유지되어 실행 중 결과에 그대로 반영되는 것, 드래그 데이터 검증을 테스트했다.
- Semantic transformation 스택: 추가·순서 변경·이름 변경·삭제(그 property와 상태 값 정리)·Undo, 지정한 transformation에 블록 넣기, 노드 전체에서 property id 고유와 라이브 키 유지, 노드당 6개 한도, AI의 새 transformation 추가와 같은 id로 교체, 모델이 준 중복 id 정리, 패널의 스택 렌더링을 테스트했다.
- 반복 노드 검사(구조가 같은 형제 3개 이상·번호만 다른 2개, 좌우 눈 같은 쌍과 state machine 노드는 제외), 배치 추론(row·radial), 위반 시 AI 재요청 1회와 그 뒤 `repeat-layout` 병합, 수정 제안은 새 노드만 검사하는 것, 이전 형식 프로젝트·의도 거부를 테스트했다.
- AI 출력 변환·검증, 중첩 블록 바인딩, Group/Ungroup/중첩/이동, 상태별 property 편집, 노드별 state machine 실행(이벤트·timed 전이·일시정지), 코드 계약 위반 거부, prompts 폴더·스키마 동기화, AI 로그 저장·복원, 소켓·블록·팔레트·Layers·State Machine UI 렌더링을 테스트했다.
- 타입 검사, 전체 테스트 84개, 프로덕션 빌드가 통과했다.
