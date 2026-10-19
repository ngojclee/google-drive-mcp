from __future__ import annotations

import logging
import sys

import uvicorn

from ga_connector.config import GaConnectorConfig
from ga_connector.server import create_app


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    config = GaConnectorConfig.from_env()
    app = create_app(config)
    uvicorn.run(app, host=config.bind_host, port=config.bind_port, proxy_headers=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
