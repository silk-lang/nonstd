-- Top customers by revenue this year
SELECT c.id, c.name, SUM(o.total) AS revenue
FROM customers AS c
JOIN orders o ON o.customer_id = c.id
WHERE o.created_at >= DATE '2026-01-01' AND o.status <> 'cancelled'
GROUP BY c.id, c.name
HAVING SUM(o.total) > 1000.50
ORDER BY revenue DESC
LIMIT 10;
