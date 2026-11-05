#!/usr/bin/env python3
"""Check kept layout results against fresh layouts on random documents.

Each seed builds a random tree of block, flex, grid and inline boxes with text,
applies a random cycle of updates (restyles, text edits, viewport resizes)
through the native adapter's update mode, and the final geometry must equal a
fresh layout of the final document. Modes bias the updates towards the paths
compute takes for them:

  mixed   any style property, some boxes relatively positioned
  inner   changes only the box itself reads (fixed border-box sizes)
  insets  padding and border alone
  text    text edits, some of them one letter in a word, under inline boxes
  grid    a separate stream with grid templates, placement and flow changes
  subgrid a separate stream with inherited axes, local names and gap transitions
  structure  inserts, moves, removals, reinsertions and destroys (Tree.insertBefore,
          remove, destroy) mixed with restyles; destroyed ids are reused, so the
          script tracks the tree's slots and compares each attached node's
          geometry with a fresh layout of the final tree in tree order
  gridstructure  the same over grid containers and items

  python3 scripts/fuzz-updates.py --cli build/.../css-layout-cli [--seeds 200] [--mode inner,text]
"""
import argparse
import copy
import json
import random
import subprocess
import sys

MODES = {
    "mixed": {"relative": 0.1, "text": 0.2, "inline": 0.1, "typo": False, "kind": "any", "repeat": 1},
    "inner": {"relative": 0.0, "text": 0.3, "inline": 0.0, "typo": True, "kind": "inner", "repeat": 3},
    "insets": {"relative": 0.0, "text": 0.3, "inline": 0.2, "typo": False, "kind": "insets", "repeat": 2},
    "text": {"relative": 0.0, "text": 1.0, "inline": 0.2, "typo": True, "kind": "any", "repeat": 2},
    "grid": {"relative": 0.1, "text": 0.3, "inline": 0.1, "typo": True, "kind": "grid", "repeat": 3},
    "subgrid": {"relative": 0.1, "text": 0.3, "inline": 0.1, "typo": True, "kind": "grid", "repeat": 3, "subgrid": True},
    "structure": {"relative": 0.1, "text": 0.2, "inline": 0.1, "typo": False, "kind": "any", "repeat": 1, "structure": True},
    "gridstructure": {"relative": 0.1, "text": 0.2, "inline": 0.1, "typo": False, "kind": "grid", "repeat": 1, "structure": True},
}
WORDS = ["ab", "word", "x", "longer", "q"]


def run(cli, document):
    completed = subprocess.run([cli], input=json.dumps(document).encode(), capture_output=True, timeout=120)
    return completed.returncode, completed.stdout


def grid_tracks(r):
    kind = r.randrange(5)
    if kind == 0:
        return [r.randint(10, 80) for _ in range(r.randint(1, 4))]
    if kind == 1:
        return [r.choice(["auto", "min-content", "max-content", {"fitContent": 60}])
                for _ in range(r.randint(1, 4))]
    if kind == 2:
        return [{"minmax": [0, {"fr": r.choice([0.5, 1, 2])}]} for _ in range(r.randint(1, 4))]
    if kind == 3:
        return [{"repeat": {"count": r.choice([2, 3, "auto-fill", "auto-fit"]),
                            "tracks": [r.randint(20, 70), {"names": ["cell"]}]}}]
    return [{"names": ["cell"]}, r.randint(20, 80), {"names": ["cell"]},
            r.randint(20, 80), {"names": ["cell"]}]


def grid_style(r):
    style = {"display": "grid", "gridTemplateColumns": grid_tracks(r), "gridTemplateRows": grid_tracks(r),
             "gridAutoColumns": [r.randint(10, 40), "auto"], "gridAutoRows": ["auto", r.randint(10, 40)],
             "gridAutoFlow": r.choice(["row", "column", "row dense", "column dense"]),
             "columnGap": r.randint(0, 8), "rowGap": r.randint(0, 8)}
    if r.random() < .2:
        style["gridTemplateAreas"] = [["a", "a"], ["b", "c"]]
    return style


def grid_line(r):
    return r.choice(["auto", 1, 2, -1, -2, "cell", {"span": r.randint(1, 3)},
                     {"line": r.choice([-2, -1, 1, 2]), "name": "cell"}, {"span": 1, "name": "cell"}])


def subgrid_axis(r):
    if r.random() < .5:
        return "subgrid"
    return {"subgrid": [
        {"names": ["cell"]},
        {"repeat": {"count": r.choice([2, "auto-fill"]), "tracks": [{"names": []}, {"names": ["cell"]}]}},
        {"names": ["edge"]},
    ]}


def random_style(r, mode):
    if r.random() < mode["inline"]:
        return {"display": "inline"}
    kind = r.choice(["block", "flex", "grid"] if mode["kind"] == "grid" else ["block", "flex"])
    style = {"display": kind, "boxSizing": "border-box"}
    if kind == "flex":
        style["flexDirection"] = r.choice(["row", "column"])
        style["flexWrap"] = r.choice(["nowrap", "wrap"])
        style["alignItems"] = r.choice(["stretch", "flex-start", "center", "baseline"])
        if r.random() < .3: style["justifyContent"] = r.choice(["flex-start", "center", "space-between"])
        if r.random() < .5: style["columnGap"] = r.randint(0, 8)
    elif kind == "grid":
        style.update(grid_style(r))
    if mode["kind"] == "grid":
        for key in ("gridRowStart", "gridRowEnd", "gridColumnStart", "gridColumnEnd"):
            if r.random() < .35: style[key] = grid_line(r)
    if r.random() < .5: style["padding"] = r.randint(0, 6)
    if r.random() < .3: style["marginTop"] = r.randint(0, 6)
    if r.random() < .3: style["width"] = r.randint(10, 200)
    if r.random() < .3: style["height"] = r.randint(5, 80)
    if r.random() < .3: style["flexGrow"] = r.randint(0, 2)
    if r.random() < mode["relative"]: style["position"] = "relative"
    if r.random() < .1: style["order"] = r.randint(-1, 2)
    if r.random() < .1: style["alignSelf"] = r.choice(["auto", "center", "baseline"])
    if r.random() < .1: style["minWidth"] = r.randint(0, 50)
    if r.random() < .1: style["border"] = r.randint(0, 3)
    return style


def text_edit(r, mode, nodes, node):
    text = nodes[node]["text"]
    if mode["typo"] and len(text) > 1:
        at = r.randrange(len(text))
        if text[at] != " ":
            return {"node": node, "text": text[:at] + r.choice("abwxl") + text[at + 1:]}
    return {"node": node, "text": " ".join(r.choice(WORDS) for _ in range(r.randint(1, 9)))}


def style_edit(r, mode, nodes, node):
    style = dict(nodes[node]["style"])
    if mode["kind"] == "grid":
        key = r.choice(["gridTemplateColumns", "gridTemplateRows", "gridAutoColumns", "gridAutoRows",
                        "gridTemplateAreas", "gridAutoFlow", "gridRowStart", "gridRowEnd",
                        "gridColumnStart", "gridColumnEnd", "order", "columnGap", "rowGap",
                        "width", "height", "padding", "border", "display"])
        if key in ("gridTemplateColumns", "gridTemplateRows"):
            style[key] = "none" if r.random() < .2 else grid_tracks(r)
            if mode.get("subgrid") and r.random() < .35:
                style[key] = subgrid_axis(r)
        elif key in ("gridAutoColumns", "gridAutoRows"):
            style[key] = ["auto", r.randint(10, 60)]
        elif key == "gridTemplateAreas":
            style[key] = r.choice([[], [["cell"]], [["a", "a"], ["b", "c"]]])
        elif key == "gridAutoFlow":
            style[key] = r.choice(["row", "column", "row dense", "column dense"])
        elif key in ("gridRowStart", "gridRowEnd", "gridColumnStart", "gridColumnEnd"):
            style[key] = grid_line(r)
        elif key == "display":
            style[key] = r.choice(["grid", "flex", "block", "none", "contents"])
        elif key == "order":
            style[key] = r.randint(-2, 3)
        elif key in ("width", "height"):
            style[key] = r.randint(10, 160)
        elif key in ("columnGap", "rowGap") and mode.get("subgrid"):
            style[key] = r.choice(["normal", 0, 3, 9])
        else:
            style[key] = r.randint(0, 9)
    elif mode["kind"] == "insets":
        style[r.choice(["padding", "paddingLeft", "paddingTop", "paddingBottom", "border", "borderTop"])] = r.choice([0, 0, 1, 3, 9])
    elif mode["kind"] == "inner":
        # A fixed border-box size from the start, so padding stays inside it.
        for key, value in (("width", r.randint(20, 300)), ("height", r.randint(10, 150)), ("flexShrink", 0)):
            style.setdefault(key, value)
        nodes[node]["style"] = dict(style)
        key = r.choice(["padding", "paddingLeft", "border", "flexDirection", "alignItems", "justifyContent", "columnGap", "flexWrap"])
        choices = {"flexDirection": ["row", "column"], "alignItems": ["stretch", "center", "baseline"], "justifyContent": ["center", "flex-end"], "flexWrap": ["wrap", "nowrap"]}
        style[key] = r.choice(choices[key]) if key in choices else r.randint(0, 9)
    else:
        key = r.choice(["padding", "width", "height", "marginTop", "flexGrow", "flexShrink", "order", "alignSelf", "minWidth", "maxHeight", "border", "insetTop", "paddingLeft"])
        if key == "alignSelf": style[key] = r.choice(["auto", "center", "baseline", "flex-end"])
        elif key in ("width", "height", "minWidth", "maxHeight"): style[key] = r.randint(0, 120)
        else: style[key] = r.randint(0, 6)
    return {"node": node, "style": style}


def case(seed, mode):
    r = random.Random(seed)
    root = {"display": r.choice(["block", "flex"]), "boxSizing": "border-box", "padding": 4}
    if mode["kind"] == "grid": root.update(grid_style(r))
    # A fixed root width hides viewport resizes from everything below it.
    if r.random() < .5: root["width"] = 800
    nodes = [{"parent": None, "style": root}]
    depth = [0]
    for _ in range(1, r.randint(20, 150)):
        parent = r.choice([index for index in range(len(nodes)) if depth[index] < 7 and "text" not in nodes[index]])
        if r.random() < .15:
            nodes.append({"parent": parent, "text": " ".join(r.choice(WORDS[:4]) for _ in range(r.randint(1, 8)))})
        else:
            nodes.append({"parent": parent, "style": random_style(r, mode)})
        depth.append(depth[parent] + 1)
    if mode.get("subgrid"):
        candidates = [index for index, node in enumerate(nodes)
                      if node.get("parent") is not None and "style" in node
                      and nodes[node["parent"]].get("style", {}).get("display") == "grid"]
        if not candidates:
            candidates.append(len(nodes))
            nodes.append({"parent": 0, "style": {"display": "grid"}})
        for ordinal, index in enumerate(candidates):
            if ordinal and r.random() < .5:
                continue
            style = nodes[index]["style"]
            style["display"] = "grid"
            axes = r.choice([1, 2, 3])
            if axes & 1:
                style.update(gridTemplateColumns=subgrid_axis(r), gridColumnStart=1, gridColumnEnd={"span": 2})
            if axes & 2:
                style.update(gridTemplateRows=subgrid_axis(r), gridRowStart=1, gridRowEnd={"span": 2})
    document = {"viewport": {"width": 800, "height": 600}, "nodes": nodes}
    texts = [index for index, node in enumerate(nodes) if "text" in node]
    elements = [index for index, node in enumerate(nodes)
                if "style" in node and (index > 0 or mode["kind"] == "grid")]
    cycle = []
    for _ in range(r.randint(1, 4)):
        changes = []
        for _ in range(r.randint(1, 2)):
            if texts and r.random() < mode["text"]:
                changes.append(text_edit(r, mode, nodes, r.choice(texts)))
            else:
                changes.append(style_edit(r, mode, nodes, r.choice(elements)))
        step = {"set": changes}
        if r.random() < .2: step["viewport"] = {"width": r.randint(500, 900), "height": 600}
        cycle.append(step)
    return document, cycle


def final(document, cycle):
    result = copy.deepcopy(document)
    for step in cycle:
        if "viewport" in step: result["viewport"] = step["viewport"]
        for change in step.get("set", []):
            if "text" in change: result["nodes"][change["node"]]["text"] = change["text"]
            else: result["nodes"][change["node"]]["style"] = change["style"]
    return result


class Slots:
    """Mirrors Tree's node slots: ids are slot indices, destroy frees a
    subtree in tree order and create takes the last freed slot."""

    def __init__(self, nodes):
        self.nodes = []
        self.free = []
        for index, node in enumerate(nodes):
            entry = {"parent": node["parent"], "children": [], "live": True}
            if "text" in node: entry["text"] = node["text"]
            else: entry["style"] = node["style"]
            self.nodes.append(entry)
            if node["parent"] is not None: self.nodes[node["parent"]]["children"].append(index)

    def create(self, content):
        entry = dict(content, parent=None, children=[], live=True)
        if self.free:
            index = self.free.pop()
            self.nodes[index] = entry
        else:
            index = len(self.nodes)
            self.nodes.append(entry)
        return index

    def unlink(self, index):
        parent = self.nodes[index]["parent"]
        if parent is not None:
            self.nodes[parent]["children"].remove(index)
            self.nodes[index]["parent"] = None

    def insert(self, parent, child, before):
        if before == child:
            siblings = self.nodes[parent]["children"]
            at = siblings.index(child) + 1
            before = siblings[at] if at < len(siblings) else None
        self.unlink(child)
        siblings = self.nodes[parent]["children"]
        siblings.insert(len(siblings) if before is None else siblings.index(before), child)
        self.nodes[child]["parent"] = parent

    def subtree(self, index):
        result = [index]
        for child in self.nodes[index]["children"]:
            result.extend(self.subtree(child))
        return result

    def destroy(self, index):
        self.unlink(index)
        for node in self.subtree(index):
            self.nodes[node]["live"] = False
            self.free.append(node)

    def attached(self):
        return self.subtree(0)

    def detached(self):
        return [index for index, node in enumerate(self.nodes)
                if index and node["live"] and node["parent"] is None]

    def document(self, viewport):
        """The attached tree in tree order, and each slot's index in it."""
        order = self.attached()
        position = {slot: at for at, slot in enumerate(order)}
        nodes = []
        for slot in order:
            node = self.nodes[slot]
            parent = None if node["parent"] is None else position[node["parent"]]
            nodes.append({"parent": parent, "text": node["text"]} if "text" in node else {"parent": parent, "style": node["style"]})
        return {"viewport": viewport, "nodes": nodes}, order


def structure_op(r, mode, slots):
    attached = slots.attached()
    elements = [index for index in attached if "style" in slots.nodes[index]]
    movable = attached[1:]
    detached = slots.detached()
    kind = r.choice(["insert", "insert", "move", "move", "remove", "destroy"] + (["reinsert"] * 2 if detached else []))
    if kind in ("move", "remove", "destroy") and not movable: kind = "insert"
    if kind == "destroy" and detached and r.random() < .3:
        node = r.choice(detached)
        slots.destroy(node)
        return {"op": "destroy", "node": node}
    if kind in ("remove", "destroy"):
        node = r.choice(movable)
        if kind == "remove": slots.unlink(node)
        else: slots.destroy(node)
        return {"op": kind, "node": node}
    if kind == "insert":
        if r.random() < mode["text"]:
            content = {"text": " ".join(r.choice(WORDS[:4]) for _ in range(r.randint(1, 6)))}
        else:
            content = {"style": random_style(r, mode)}
        op = dict({"op": "insert"}, **content)
        node = slots.create(content)
        if r.random() < .1:
            return op  # left outside the tree for a later reinsert
    else:
        node = r.choice(movable if kind == "move" else detached)
        op = {"op": "move", "node": node}
    inside = set(slots.subtree(node))
    parent = r.choice([index for index in elements if index not in inside])
    children = slots.nodes[parent]["children"]
    before = r.choice(children + [None, None]) if children else None
    slots.insert(parent, node, before)
    op.update(parent=parent, before=before)
    return op


def structure_case(seed, mode):
    """A random document, a cycle of structural steps and the final tree."""
    document, _ = case(seed, mode)
    r = random.Random(seed * 7919 + 1)
    slots = Slots(document["nodes"])
    viewport = document["viewport"]
    cycle = []
    for _ in range(r.randint(1, 6)):
        step = {"ops": [structure_op(r, mode, slots) for _ in range(r.randint(1, 3))]}
        live = [index for index in slots.attached() if index > 0]
        changes = []
        for _ in range(r.randint(0, 2)):
            if not live: break
            node = r.choice(live)
            if "text" in slots.nodes[node]:
                change = text_edit(r, mode, slots.nodes, node)
                slots.nodes[node]["text"] = change["text"]
            else:
                change = style_edit(r, mode, slots.nodes, node)
                slots.nodes[node]["style"] = change["style"]
            changes.append(change)
        if changes: step["set"] = changes
        if r.random() < .2:
            viewport = {"width": r.randint(500, 900), "height": 600}
            step["viewport"] = viewport
        cycle.append(step)
    fresh, order = slots.document(viewport)
    return document, cycle, fresh, order


def structure_matches(kept, fresh, order):
    """Whether each attached slot's source and every box match the fresh layout."""
    kept, fresh = json.loads(kept), json.loads(fresh)
    # Boxes name their sources by id, which differ between the two trees.
    position = {slot: at for at, slot in enumerate(order)}
    for box in kept["boxes"]:
        for key in ("source", "styleOwner"):
            if box.get(key) is not None: box[key] = position.get(box[key], -1)
    if kept["boxes"] != fresh["boxes"]: return False
    return all(kept["sources"][slot] == fresh["sources"][at] for at, slot in enumerate(order))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cli", required=True)
    parser.add_argument("--seeds", type=int, default=200, help="seeds per mode")
    parser.add_argument("--first", type=int, default=0, help="first seed")
    parser.add_argument("--mode", default=",".join(MODES))
    args = parser.parse_args()
    failures = 0
    total = 0
    for name in args.mode.split(","):
        mode = MODES[name]
        for seed in range(args.first, args.first + args.seeds):
            if mode.get("structure"):
                total += 1
                document, cycle, final_document, order = structure_case(seed, mode)
                fresh_code, fresh = run(args.cli, final_document)
                code, kept = run(args.cli, dict(document, updates={"iterations": len(cycle), "cycle": cycle}))
                if fresh_code != 0 or code != 0 or not structure_matches(kept, fresh, order):
                    failures += 1
                    print(f"differs from a fresh layout: mode {name} seed {seed} (exit {code}, fresh {fresh_code})", file=sys.stderr)
                continue
            document, cycle = case(seed, mode)
            total += 1
            fresh_code, fresh = run(args.cli, final(document, cycle))
            if fresh_code != 0:
                failures += 1
                print(f"fresh layout failed: mode {name} seed {seed}, exit {fresh_code}", file=sys.stderr)
                continue
            # Repeating the cycle ends on the same document.
            updates = {"iterations": len(cycle) * mode["repeat"], "cycle": cycle}
            code, kept = run(args.cli, dict(document, updates=updates))
            if code != 0 or json.loads(kept) != json.loads(fresh):
                failures += 1
                print(f"differs from a fresh layout: mode {name} seed {seed}", file=sys.stderr)
    print(f"{total} random update cycles, {failures} failures")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
