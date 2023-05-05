let selected_node: SVGRectElement | null = null;
let offset_x = 0;
let offset_y = 0;
let global_offset_x = 0;
let global_offset_y = 0;
let global_zoom = 1;
const nodeSize = 50;

enum State {
    Drag = "drag",
    Create = "create",
    Connect = "connect",
    Delete = "delete",
}

enum DragState {
    DraggingNode = "dragging_node",
    DraggingGraph = "dragging_graph",
    None = "none",
}

type GraphNodeId = {
    id: string;
};

type Position = {
    x: number;
    y: number;
};

enum NodeType {
    Place = "place",
    Transition = "transition",
}

type GraphNode = {
    id: GraphNodeId;
    node_type: NodeType;
    position: Position;
};


type Edge = {
    start_node_id: GraphNodeId;
    end_node_id: GraphNodeId;
    start_position: Position;
    end_position: Position;
};

let state: State = State.Drag;
let dragState: DragState = DragState.None;
let new_node_type: NodeType = NodeType.Place;


var canvas = document.getElementById("canvas");
if (!canvas || !(canvas instanceof SVGSVGElement)) {
    throw new Error("canvas not found");
}


function changeState(newState: State) {
    const stateText = document.getElementById("state");
    if (!stateText) {
        throw new Error("stateText not found");
    }
    stateText.textContent = newState;
    state = newState;
    selected_node = null;
}

function transformCoords(x: number, y: number, screenToGraph: boolean): SVGPoint {
    const svg = document.getElementById("canvas");
    const graph = document.getElementById("graph");
    if (!(graph instanceof SVGGElement) || !(svg instanceof SVGSVGElement)) {
        throw new Error("Could not find SVGSVGElement with ID 'graph'");
    }

    const pt = svg.createSVGPoint();
    pt.x = x;
    pt.y = y;

    const screenCTM = graph.getScreenCTM();
    if (screenCTM) {
        return pt.matrixTransform(screenToGraph ? screenCTM.inverse() : screenCTM);
    }

    return pt;
}

function graphToScreenCoords(x: number, y: number): SVGPoint {
    return transformCoords(x, y, false)
}

function screenToGraphCoords(x: number, y: number): SVGPoint {
    return transformCoords(x, y, true)
}


function dragStart(event: MouseEvent) {
    if (event.target instanceof SVGRectElement) {
        selected_node = event.target;
    } else if (event.target instanceof SVGTextElement) {
        selected_node = event.target.previousElementSibling as SVGRectElement;
    } else if (event.target instanceof SVGSVGElement) {
        selected_node = null;
        offset_x = event.clientX;
        offset_y = event.clientY;
        dragState = DragState.DraggingGraph;
        return;
    } else {
        return;
    }
    const point = graphToScreenCoords(
        parseInt(selected_node.getAttribute("x")!),
        parseInt(selected_node.getAttribute("y")!)
    );
    offset_x = event.clientX - point.x;
    offset_y = event.clientY - point.y;
    dragState = DragState.DraggingNode;
}

function updateGraphTransform() {
    const graph = document.getElementById("graph")!;
    if (!(canvas instanceof SVGSVGElement) || !(graph instanceof SVGGraphicsElement)) {
        throw new Error("canvas or graph not found");
    }

    const scale = canvas.createSVGTransform();
    scale.setScale(global_zoom, global_zoom);

    // Translate to the current offset
    const translateOffset = canvas.createSVGTransform();
    translateOffset.setTranslate(global_offset_x / global_zoom, global_offset_y / global_zoom);

    const transformList = graph.transform.baseVal;
    transformList.clear();
    transformList.appendItem(scale);
    transformList.appendItem(translateOffset);
}



function drag(event: MouseEvent) {
    if (dragState === DragState.DraggingNode && selected_node) {
        const point = screenToGraphCoords(event.clientX - offset_x, event.clientY - offset_y);
        selected_node.setAttribute("x", point.x.toString());
        selected_node.setAttribute("y", point.y.toString());
        updateEdges();
        const label = selected_node.nextElementSibling as SVGTextElement;
        label.setAttribute("x", point.x.toString());
        label.setAttribute("y", point.y.toString());
    } else if (dragState === DragState.DraggingGraph) {
        global_offset_x += event.clientX - offset_x;
        global_offset_y += event.clientY - offset_y;
        offset_x = event.clientX;
        offset_y = event.clientY;
        updateGraphTransform();
    }
}

function dragEnd(_event: MouseEvent) {
    if (dragState === DragState.DraggingNode) {
        var node_id = selected_node!.getAttribute("data-id")!;
        var x = parseInt(selected_node!.getAttribute("x")!);
        var y = parseInt(selected_node!.getAttribute("y")!);
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/move");
        xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
        xhr.send(`node_id=${node_id}&x=${x}&y=${y}`);
        selected_node = null;
    }
    dragState = DragState.None;
}

function handleScroll(event: WheelEvent) {
    global_zoom = Math.min(Math.max(0.125, global_zoom + event.deltaY * -0.01), 4);
    updateGraphTransform();
    event.preventDefault();
}


function connectClick(event: MouseEvent) {
    var node: SVGRectElement;
    if (event.target instanceof SVGRectElement) {
        node = event.target;
    } else if (event.target instanceof SVGTextElement) {
        node = event.target.previousElementSibling as SVGRectElement;
    } else {
        return;
    }

    if (selected_node && selected_node !== node) {
        var start_node_id = selected_node.getAttribute("data-id");
        var end_node_id = node.getAttribute("data-id");
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/connect");
        xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
        xhr.onreadystatechange = () => {
            if (xhr.readyState === XMLHttpRequest.DONE && xhr.status === 200) {
                var edge = JSON.parse(xhr.responseText);
                addEdgeToCanvas(edge);
            }
        };
        xhr.send(`start_node_id=${start_node_id}&end_node_id=${end_node_id}`);

        selected_node = null;
        changeState(State.Drag);
    } else {
        selected_node = node;
    }

}

function createClick(event: MouseEvent) {
    var point = screenToGraphCoords(event.clientX, event.clientY);
    var node_type = new_node_type;

    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/create");
    xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    xhr.onreadystatechange = () => {
        if (xhr.readyState === XMLHttpRequest.DONE && xhr.status === 200) {
            var node = JSON.parse(xhr.responseText);
            addNodeToCanvas(node);
        }
    };
    xhr.send(`x=${point.x}&y=${point.y}&node_type=${node_type}`);
}

function deleteClick(event: MouseEvent) {
    var node: SVGRectElement;
    if (event.target instanceof SVGRectElement) {
        node = event.target;
    } else if (event.target instanceof SVGTextElement) {
        node = event.target.previousElementSibling as SVGRectElement;
    } else {
        return;
    }
    var node_id = node.getAttribute("data-id");
    if (!node_id) {
        throw new Error("node_id not found");
    }
    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/delete");
    xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    xhr.onreadystatechange = () => {
        if (xhr.readyState === XMLHttpRequest.DONE && xhr.status === 200) {
            removeNodeFromCanvas(node_id!);
        }
    };
    xhr.send(`node_id=${node_id}`);
}

function addEdgeToCanvas(edge: Edge) {
    const edges = document.getElementById("edges");
    if (!edges) throw new Error("edges not found");

    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", "arrow");
    marker.setAttribute("markerWidth", "10");
    marker.setAttribute("markerHeight", "10");
    marker.setAttribute("refX", "8");
    marker.setAttribute("refY", "5");
    marker.setAttribute("orient", "auto-start-reverse");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    path.setAttribute("fill", "black");

    marker.appendChild(path);
    edges.appendChild(marker);

    let { start_x, start_y, end_x, end_y } = computeEdgeOffsetPosition(edge);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("class", "edge");
    line.setAttribute("x1", start_x.toString());
    line.setAttribute("y1", start_y.toString());
    line.setAttribute("x2", end_x.toString());
    line.setAttribute("y2", end_y.toString());
    line.setAttribute("marker-end", "url(#arrow)");
    line.setAttribute("data-start-node-id", edge.start_node_id.id);
    line.setAttribute("data-end-node-id", edge.end_node_id.id);
    line.setAttribute("stroke", "black");

    edges.appendChild(line);
}


function computeEdgeOffsetPosition(edge: Edge) {
    const angle = Math.atan2(edge.end_position.y - edge.start_position.y, edge.end_position.x - edge.start_position.x);
    const end_offset = nodeSize / 2 + 5;
    const start_x = edge.start_position.x + end_offset * Math.cos(angle);
    const start_y = edge.start_position.y + end_offset * Math.sin(angle);
    const end_x = edge.end_position.x - end_offset * Math.cos(angle);
    const end_y = edge.end_position.y - end_offset * Math.sin(angle);
    return { start_x, start_y, end_x, end_y };
}

function addNodeToCanvas(node: GraphNode) {
    var nodes = document.getElementById("nodes");
    if (!nodes) throw new Error("nodes not found");
    var rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("class", "node");
    rect.setAttribute("x", (node.position.x).toString());
    rect.setAttribute("y", (node.position.y).toString());
    rect.setAttribute("width", nodeSize.toString());
    rect.setAttribute("height", nodeSize.toString());
    rect.setAttribute("transform", `translate(${-nodeSize / 2}, ${-nodeSize / 2})`);
    const radius = node.node_type === NodeType.Place ? 0 : 2000;
    rect.setAttribute("rx", radius.toString());
    rect.setAttribute("fill", "#eee");
    rect.setAttribute("stroke", "#ccc");
    rect.setAttribute("stroke-width", "1");
    rect.setAttribute("data-id", node.id.id);
    nodes.appendChild(rect);
    var text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", (node.position.x).toString());
    text.setAttribute("y", (node.position.y).toString());
    text.setAttribute("data-id", node.id.id);
    text.setAttribute("font-size", "20");
    text.setAttribute("font-family", "Arial");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.textContent = node.id.id;
    nodes.appendChild(text);
}

function removeNodeFromCanvas(node_id: string) {
    var nodes = document.getElementById("nodes");
    if (!nodes) {
        throw new Error("nodes not found");
    }
    var node_elements = document.querySelectorAll(`[data-id="${node_id}"]`);
    if (!node_elements) {
        throw new Error("node not found");
    }
    node_elements.forEach(element => {
        nodes?.removeChild(element);
    });
    var edges = document.getElementsByClassName("edge");
    for (var i = edges.length - 1; i >= 0; i--) {
        const start_node_id = edges[i].getAttribute("data-start-node-id");
        const end_node_id = edges[i].getAttribute("data-end-node-id");
        if (start_node_id === node_id || end_node_id === node_id) {
            edges[i].remove();
        }
    }
}

function updateEdges() {
    const edges = document.getElementsByClassName("edge");

    for (var i = edges.length - 1; i >= 0; i--) {
        const start_node_id = edges[i].getAttribute("data-start-node-id");
        const end_node_id = edges[i].getAttribute("data-end-node-id");
        let start_node = canvas!.querySelector(`[data-id="${start_node_id}"]`);
        let end_node = canvas!.querySelector(`[data-id="${end_node_id}"]`);

        let start_position = { x: Number(start_node?.getAttribute("x")), y: Number(start_node?.getAttribute("y")) };
        let end_position = { x: Number(end_node?.getAttribute("x")), y: Number(end_node?.getAttribute("y")) };

        let { start_x, start_y, end_x, end_y } = computeEdgeOffsetPosition({
            start_position: start_position,
            end_position: end_position,
            end_node_id: { id: start_node_id! },
            start_node_id: { id: end_node_id! }
        });

        edges[i].setAttribute("x1", (start_x).toString());
        edges[i].setAttribute("y1", (start_y).toString());
        edges[i].setAttribute("x2", (end_x).toString());
        edges[i].setAttribute("y2", (end_y).toString());
    }
}

function renderNodes() {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "/nodes");
    xhr.onreadystatechange = () => {
        if (xhr.readyState === XMLHttpRequest.DONE && xhr.status === 200) {
            var nodes = JSON.parse(xhr.responseText);
            for (var node of nodes) {
                addNodeToCanvas(node);
            }
        }
    };
    xhr.send();
}

function renderEdges() {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "/edges");
    xhr.onreadystatechange = () => {
        if (xhr.readyState === XMLHttpRequest.DONE && xhr.status === 200) {
            var edges = JSON.parse(xhr.responseText);
            for (var edge of edges) {
                addEdgeToCanvas(edge);
            }
        }
    };
    xhr.send();
}

function clearAll() {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/clear");
    xhr.onreadystatechange = () => {
        if (xhr.readyState === XMLHttpRequest.DONE && xhr.status === 200) {
            var nodes = document.getElementById("nodes");
            if (!nodes) throw new Error("nodes not found");
            while (nodes.firstChild) {
                nodes.removeChild(nodes.firstChild);
            }
            var edges = document.getElementById("edges");
            if (!edges) throw new Error("edges not found");
            while (edges.firstChild) {
                edges.removeChild(edges.firstChild);
            }
        }
    };
    xhr.send();
}


canvas.addEventListener("mousedown", (event: MouseEvent) => {
    switch (state) {
        case State.Drag:
            dragStart(event);
            break;
        case State.Create:
            createClick(event);
            changeState(State.Drag);
            break;
        case State.Connect:
            connectClick(event);
            break;
        case State.Delete:
            deleteClick(event);
            changeState(State.Drag);
            break;
    }
});
canvas.addEventListener("mousemove", (event: MouseEvent) => {
    switch (state) {
        case State.Drag:
            drag(event);
            break;
        case State.Create:
            break;
        case State.Connect:
            break;
        case State.Delete:
            break;
    }
});
canvas.addEventListener("mouseup", (event: MouseEvent) => {
    switch (state) {
        case State.Drag:
            dragEnd(event);
            break;
        case State.Create:
            break;
        case State.Connect:
            break;
        case State.Delete:
            break;
    }
}
);
canvas.addEventListener("mouseleave", (event: MouseEvent) => {
    switch (state) {
        case State.Drag:
            dragEnd(event);
            break;
        case State.Create:
            break;
        case State.Connect:
            break;
        case State.Delete:
            break;
    }
});
canvas.addEventListener("wheel", (event: WheelEvent) => { handleScroll(event) });

document.getElementById('btn-create-place')?.addEventListener('click', () => {
    changeState(State.Create);
    new_node_type = NodeType.Place;
});
document.getElementById('btn-create-transition')?.addEventListener('click', () => {
    changeState(State.Create);
    new_node_type = NodeType.Transition;
});
document.getElementById('btn-connect')?.addEventListener('click', () => { changeState(State.Connect) });
document.getElementById('btn-delete')?.addEventListener('click', () => { changeState(State.Delete) });
document.getElementById('btn-clear')?.addEventListener('click', () => { clearAll() });

renderNodes();
renderEdges();