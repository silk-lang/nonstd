//! Bounds repeated graph traversal independently of either parser.
use std::{
    cell::RefCell,
    io::{self, Write},
};
pub trait DumpTable {
    fn dump(&self, out: &mut impl Write, path: &str) -> io::Result<()>;
}
#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct Key {
    typ: u32,
    remaining: usize,
    args: [u64; 3],
}
#[derive(Clone, Copy, Default)]
struct Node {
    key: Key,
    id: usize,
}
struct State {
    visits: usize,
    args: [u64; 3],
    nodes: Vec<Node>,
    next_node: usize,
    scope_start: usize,
}
impl State {
    fn new() -> Self {
        Self {
            visits: 0,
            args: [0; 3],
            nodes: vec![Node::default(); 16384],
            next_node: 1,
            scope_start: 1,
        }
    }
}
thread_local! { static STATE: RefCell<State> = RefCell::new(State::new()); }
pub fn reset() {
    STATE.with(|state| *state.borrow_mut() = State::new());
}
pub fn begin_table() {
    STATE.with(|state| {
        let mut s = state.borrow_mut();
        s.scope_start = s.next_node;
        s.args = [0; 3];
    });
}
pub fn arguments() -> [u64; 3] {
    STATE.with(|s| s.borrow().args)
}
pub fn set_arguments(args: [u64; 3]) {
    STATE.with(|s| s.borrow_mut().args = args);
}
pub fn enter(path: &str) -> bool {
    if path.bytes().filter(|&b| b == b'.').count() + 1 >= 64 {
        return false;
    }
    STATE.with(|state| {
        let mut s = state.borrow_mut();
        if s.visits >= 10_000_000 {
            return false;
        }
        s.visits += 1;
        true
    })
}
pub fn visit(
    out: &mut impl Write,
    path: &str,
    typ: u32,
    remaining: usize,
    args: [u64; 3],
) -> io::Result<bool> {
    if !enter(path) {
        writeln!(out, "{path}=traversal-limit")?;
        return Ok(false);
    }
    let (id, repeated) = STATE.with(|state| {
        let mut s = state.borrow_mut();
        let key = Key {
            typ,
            remaining,
            args,
        };
        let mut hash = u64::from(typ).wrapping_mul(1099511628211) ^ remaining as u64;
        for arg in args {
            hash = hash.wrapping_mul(1099511628211) ^ arg;
        }
        let first = (hash & 16383) as usize;
        let mut slot = first;
        let mut probes = 0;
        while probes < 16384 && s.nodes[slot].id >= s.scope_start {
            if s.nodes[slot].key == key {
                return (s.nodes[slot].id, true);
            }
            slot = (slot + 1) & 16383;
            probes += 1;
        }
        if probes == 16384 {
            slot = first;
        }
        let id = s.next_node;
        s.next_node += 1;
        s.nodes[slot] = Node { key, id };
        (id, false)
    });
    writeln!(out, "{path}.{}={id}", if repeated { "ref" } else { "node" })?;
    Ok(!repeated)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distinct_glyph_scopes_do_not_alias_equal_sized_views() {
        reset();
        let mut out = Vec::new();
        assert!(visit(&mut out, "glyph[0]", 9, 12, [0; 3]).unwrap());
        assert!(!visit(&mut out, "glyph[0].alias", 9, 12, [0; 3]).unwrap());
        begin_table();
        begin_table(); // An empty scope must also preserve monotonic node IDs.
        assert!(visit(&mut out, "glyph[1]", 9, 12, [0; 3]).unwrap());
        assert!(!visit(&mut out, "glyph[1].alias", 9, 12, [0; 3]).unwrap());
        assert_eq!(
            String::from_utf8(out).unwrap(),
            "glyph[0].node=1\nglyph[0].alias.ref=1\nglyph[1].node=2\nglyph[1].alias.ref=2\n"
        );
    }
}
