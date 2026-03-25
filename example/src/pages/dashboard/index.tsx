import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/providers/role-context';
import { useQuery } from 'convex/react';
import { BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';

import { api } from '../../../convex/_generated/api';

function formatDate(dateStr: string | undefined) {
  if (!dateStr) return '\u2014';
  return new Date(dateStr).toLocaleDateString();
}

export function Dashboard() {
  const { currentUser } = useRole();
  const subscriptions = useQuery(api.queries.listSubscriptions);
  const courses = useQuery(api.courses.list);

  // Find the current user's active subscription (match by userId pattern)
  const userSubscription = subscriptions?.find(
    (s) => s.status === 'active' || s.status === 'trialing',
  );

  const hasSubscription = !!userSubscription;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Welcome back, {currentUser.name}</h1>
        <p className="text-muted-foreground mt-1">
          Here's an overview of your learning journey.
        </p>
      </div>

      {/* Subscription Status */}
      {hasSubscription ? (
        <Card>
          <CardHeader>
            <CardTitle>Your Subscription</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {userSubscription.stripeSubscriptionId}
                </p>
                <p className="text-muted-foreground text-sm">
                  Renews {formatDate(userSubscription.currentPeriodEnd)}
                </p>
              </div>
              <Badge variant="default" className="capitalize">
                {userSubscription.status}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <Alert>
              <AlertTitle>No Active Subscription</AlertTitle>
              <AlertDescription>
                Subscribe to unlock all courses and learning materials.
              </AlertDescription>
            </Alert>
            <Button asChild className="mt-4">
              <Link to="/">View Plans</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Courses */}
      <div>
        <h2 className="mb-4 text-2xl font-bold">Available Courses</h2>
        {courses === undefined ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="space-y-3 p-6">
                  <Skeleton className="h-8 w-8" />
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : courses.length === 0 ? (
          <Alert>
            <AlertDescription>No courses available yet.</AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <Card
                key={course._id}
                className="hover:border-primary/50 transition-colors"
              >
                <CardContent className="p-6">
                  <BookOpen className="text-muted-foreground mb-3 h-8 w-8" />
                  <h3 className="mb-1 font-semibold">{course.title}</h3>
                  <p className="text-muted-foreground text-sm">
                    {course.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
