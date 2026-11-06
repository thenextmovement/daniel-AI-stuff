"""Integration race test; only the isolated, network-disabled TICKET-300 container."""
import concurrent.futures
import pathlib
import subprocess
import threading

CONTAINER = "t300-collective-db"
def sql(statement):
    p = subprocess.run(["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1"], input=statement, text=True, capture_output=True)
    if p.returncode:
        raise AssertionError(p.stderr)
    return p.stdout.strip()

fixture = pathlib.Path(__file__).with_name("database.test.sql").read_text().split("SELECT pg_temp.expect_error")[0]
fixture = fixture.replace("CREATE TEMP TABLE inputs", "CREATE TABLE t300_inputs")
sql(fixture + "\nCOMMIT;")
try:
    barrier = threading.Barrier(4)
    def ingest(_):
        barrier.wait()
        return sql("BEGIN; SELECT billing_collective_payment_ingest(payment,allocations)->>'duplicate' FROM t300_inputs; SELECT pg_sleep(0.2); COMMIT;")
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(ingest, range(4)))
    assert sum("\nfalse\n" in r for r in results) == 1, results
    assert sum("\ntrue\n" in r for r in results) == 3, results
    actual = sql("SELECT (SELECT count(*) FROM billing_payments)||'|'||(SELECT sum(amount_cents) FROM billing_payments)||'|'||(SELECT count(*) FROM processed_transactions)||'|'||(SELECT count(*) FROM billing_jobs);")
    assert actual == "2|30000|1|4", actual
    print("PASS: four concurrent deliveries produce two allocations, one bank receipt, and four jobs.")
finally:
    sql("TRUNCATE billing_cases,processed_transactions CASCADE; DROP TABLE t300_inputs;")
