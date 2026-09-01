"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { register } from "@/lib/api";

const SECTOR_OPTIONS = [
  "Fintech",
  "Healthtech",
  "SaaS",
  "Consumer",
  "Marketplace",
  "AI/ML",
  "Climate",
  "Hardware",
];

export default function RegisterPage() {
  const router = useRouter();
  const [role, setRole] = useState("startup");
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [sectorExpertise, setSectorExpertise] = useState([]);
  const [pastExits, setPastExits] = useState("");
  const [stageFocus, setStageFocus] = useState("");
  const [geography, setGeography] = useState("");
  const [availability, setAvailability] = useState("");

  function toggleSector(sector) {
    setSectorExpertise((prev) =>
      prev.includes(sector) ? prev.filter((s) => s !== sector) : [...prev, sector]
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);

    const profile =
      role === "mentor"
        ? {
            name,
            sector_expertise: sectorExpertise,
            past_exits: pastExits,
            stage_focus: stageFocus,
            geography,
            availability,
          }
        : { name };

    try {
      const data = await register({ email, password, role, profile });
      const token = data?.token || data?.access_token || data?.jwt;
      if (token) {
        window.localStorage.setItem("token", token);
        toast.success("Account created.");
        router.push("/upload");
      } else {
        toast.success("Account created. Please sign in.");
        router.push("/login");
      }
    } catch (err) {
      toast.error(err.message || "Could not create account.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Navbar />
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Create an account</CardTitle>
            <CardDescription>
              Join Mentora as a startup or a mentor.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={role} onValueChange={setRole}>
              <TabsList className="w-full">
                <TabsTrigger value="startup" className="flex-1">
                  Startup
                </TabsTrigger>
                <TabsTrigger value="mentor" className="flex-1">
                  Mentor
                </TabsTrigger>
              </TabsList>

              <form onSubmit={handleSubmit} className="space-y-4 mt-6">
                <div className="space-y-1.5">
                  <Label htmlFor="register-name">Name</Label>
                  <Input
                    id="register-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="register-email">Email</Label>
                  <Input
                    id="register-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="register-password">Password</Label>
                  <Input
                    id="register-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                <TabsContent value="mentor" className="space-y-4 mt-0">
                  <div className="space-y-1.5">
                    <Label>Sector expertise</Label>
                    <div className="flex flex-wrap gap-2">
                      {SECTOR_OPTIONS.map((sector) => {
                        const active = sectorExpertise.includes(sector);
                        return (
                          <Badge
                            key={sector}
                            variant={active ? "default" : "outline"}
                            className="cursor-pointer select-none"
                            onClick={() => toggleSector(sector)}
                          >
                            {sector}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="past-exits">Past exits</Label>
                    <Input
                      id="past-exits"
                      placeholder="e.g. 2 (Acme Inc., Foo Corp.)"
                      value={pastExits}
                      onChange={(e) => setPastExits(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Stage focus</Label>
                    <Select value={stageFocus} onValueChange={setStageFocus}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a stage" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="idea">Idea</SelectItem>
                        <SelectItem value="MVP">MVP</SelectItem>
                        <SelectItem value="growth">Growth</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="geography">Geography</Label>
                    <Input
                      id="geography"
                      placeholder="e.g. San Francisco, Remote"
                      value={geography}
                      onChange={(e) => setGeography(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Availability</Label>
                    <Select value={availability} onValueChange={setAvailability}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select availability" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Full-time">Full-time</SelectItem>
                        <SelectItem value="Few hours/week">
                          Few hours/week
                        </SelectItem>
                        <SelectItem value="Ad-hoc">Ad-hoc</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </TabsContent>

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? "Creating account..." : "Create Account"}
                </Button>
              </form>
            </Tabs>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
