import { add, fib, hypot, isPrime } from './math.silk'

const sum: number = add(2, 40)
const big: bigint = fib(90)
console.log(`add(2, 40) = ${sum}`)
console.log(`hypot(3, 4) = ${hypot(3, 4)}`)
console.log(`fib(90) = ${big}`)
console.log(`primes under 30: ${[...Array(30).keys()].filter((n) => isPrime(n)).join(', ')}`)
