#! /usr/bin/env python3

import typer
from typer.core import TyperGroup
import re

class AliasGroup(TyperGroup):
    _CMD_SPLIT_P = re.compile(r" ?[,|] ?")

    def get_command(self, ctx, cmd_name):
        cmd_name = self._group_cmd_name(cmd_name)
        return super().get_command(ctx, cmd_name)

    def _group_cmd_name(self, default_name):
        for cmd in self.commands.values():
            name = cmd.name
            if name and default_name in self._CMD_SPLIT_P.split(name):
                return name
        return default_name

app = typer.Typer(cls=AliasGroup, no_args_is_help=True)

@app.command("add, a", help="Add a dependency", no_args_is_help=True)
def add(url: str = typer.Argument(..., help="The URL of the package to add")):
  typer.echo(f"Adding {url}...")

@app.command("remove, r", help="Remove a dependency", no_args_is_help=True)
def remove(name: str = typer.Argument(..., help="The name of the package to remove")):
  typer.echo(f"Removing {name}...")

@app.command("list, ls", help="List all dependencies")
def list():
  typer.echo("Listing packages...")

if __name__ == "__main__":
  app()