// Copyright 2022 the Fontations Authors. Licensed under Apache-2.0 or MIT.
impl<T> crate::dump_support::DumpTable for TypedLookup<'_, T> {
    fn dump(&self, out: &mut impl Write, path: &str) -> io::Result<()> {
        dump_Lookup(out, path, &self.lookup)
    }
}
