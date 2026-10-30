package main

import (
	"fmt"
	"strings"
)

type Stack[T any] struct {
	items []T
}

func (s *Stack[T]) Push(item T) { s.items = append(s.items, item) }

func (s *Stack[T]) Pop() (T, bool) {
	var zero T
	if len(s.items) == 0 {
		return zero, false
	}
	item := s.items[len(s.items)-1]
	s.items = s.items[:len(s.items)-1]
	return item, true
}

func main() {
	s := &Stack[string]{}
	s.Push(strings.ToUpper("hello"))
	v, ok := s.Pop()
	fmt.Printf("%q %v\n", v, ok)
}
