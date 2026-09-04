"""Release gate plugin: a missing applicable test cannot count as success."""


def pytest_sessionfinish(session, exitstatus):
    reporter = session.config.pluginmanager.get_plugin("terminalreporter")
    skipped = reporter.stats.get("skipped", []) if reporter else []
    if skipped:
        reporter.write_sep("!", "release tests may not skip applicable cases")
        for report in skipped:
            reporter.write_line(report.nodeid)
        session.exitstatus = 1
